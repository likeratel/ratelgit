import Foundation
import RatelGitCore
import XCTest
@testable import RatelGit

final class ChangeTests: XCTestCase {
    private let original = (1...20).map { "line \($0)" }.joined(separator: "\n") + "\n"

    private func makeRepository() throws -> (URL, Git) {
        let root = try makeTemporaryDirectory()
        try shell(root, "init", "-q", "-b", "main")
        try put(original, in: root, "notes.txt")
        try commitAll(root, "Base")
        return (root, Git(path: root.path))
    }

    private func edited(_ changes: [Int: String], inserting: [Int: [String]] = [:]) -> String {
        (1...20).flatMap { number -> [String] in
            [changes[number] ?? "line \(number)"] + (inserting[number] ?? [])
        }.joined(separator: "\n") + "\n"
    }

    private func file(_ client: Git, _ kind: ChangeKind) throws -> ChangedFile {
        try XCTUnwrap(client.workingFiles().first { $0.kind == kind })
    }

    func testStageAndUnstageHunksAndLines() throws {
        let (root, client) = try makeRepository()
        defer { try? FileManager.default.removeItem(at: root) }
        try put(edited([2: "line two"], inserting: [17: ["added a", "added b"]]), in: root, "notes.txt")
        let unstaged = try file(client, .unstaged)
        let source = try client.diff(unstaged)
        let patch = FilePatch(source)
        XCTAssertEqual(patch.hunks.count, 2)

        try client.execute(.applyLines(unstaged, source: source, lines: Set(patch.changedLines(in: patch.hunks[0])), .stage))
        let staged = try client.diff(try file(client, .staged))
        XCTAssertTrue(staged.contains("+line two"))
        XCTAssertFalse(staged.contains("added a"))
        let remaining = try client.diff(try file(client, .unstaged))
        XCTAssertFalse(remaining.contains("+line two"))
        XCTAssertTrue(remaining.contains("+added a"))

        let second = FilePatch(remaining)
        let onlyB = try XCTUnwrap(second.lines.indices.first { second.lines[$0] == "+added b" })
        try client.execute(.applyLines(try file(client, .unstaged), source: remaining, lines: [onlyB], .stage))
        let index = try gitOutput(root, ["show", ":notes.txt"])
        XCTAssertTrue(index.contains("line 17\nadded b\nline 18"))
        XCTAssertFalse(index.contains("added a"))
        XCTAssertEqual(try read(root, "notes.txt"), edited([2: "line two"], inserting: [17: ["added a", "added b"]]))

        let stagedSource = try client.diff(try file(client, .staged))
        let stagedPatch = FilePatch(stagedSource)
        let pair = Set(stagedPatch.lines.indices.filter { ["-line 2", "+line two"].contains(stagedPatch.lines[$0]) })
        XCTAssertEqual(pair.count, 2)
        try client.execute(.applyLines(try file(client, .staged), source: stagedSource, lines: pair, .unstage))
        let afterUnstage = try gitOutput(root, ["show", ":notes.txt"])
        XCTAssertTrue(afterUnstage.hasPrefix("line 1\nline 2\nline 3\n"))
        XCTAssertTrue(afterUnstage.contains("added b"))
        XCTAssertEqual(try read(root, "notes.txt"), edited([2: "line two"], inserting: [17: ["added a", "added b"]]),
                       "unstaging never touches the worktree")
    }

    func testDiscardHunkFileAndUntracked() throws {
        let (root, client) = try makeRepository()
        defer { try? FileManager.default.removeItem(at: root) }
        try put(edited([2: "line two", 19: "line nineteen"]), in: root, "notes.txt")
        let source = try client.diff(try file(client, .unstaged))
        let patch = FilePatch(source)
        try client.execute(.applyLines(try file(client, .unstaged), source: source,
                                       lines: Set(patch.changedLines(in: patch.hunks[1])), .discard))
        XCTAssertEqual(try read(root, "notes.txt"), edited([2: "line two"]))

        try put("changed again\n", in: root, "notes.txt")
        XCTAssertThrowsError(try client.execute(.applyLines(try file(client, .unstaged), source: source,
                                                            lines: Set(patch.changedLines(in: patch.hunks[0])), .discard)),
                             "a stale diff is refused")
        try client.execute(.discard(try file(client, .unstaged)))
        XCTAssertEqual(try read(root, "notes.txt"), original)

        try put("scratch\n", in: root, "dir/new [file].txt")
        let untracked = try file(client, .untracked)
        try client.execute(.discard(untracked))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("dir/new [file].txt").path))
        XCTAssertThrowsError(try client.execute(.discard(untracked)), "the file is gone, so the status check fails")
        XCTAssertTrue(try client.workingFiles().isEmpty)
    }

    func testIgnoreWhitespaceDiff() throws {
        let (root, client) = try makeRepository()
        defer { try? FileManager.default.removeItem(at: root) }
        try put(edited([3: "    line 3", 10: "line ten"]), in: root, "notes.txt")
        let changed = try file(client, .unstaged)
        let plain = try client.diff(changed)
        let quiet = try client.diff(changed, ignoreWhitespace: true)
        XCTAssertTrue(plain.contains("+    line 3"))
        XCTAssertFalse(quiet.contains("+    line 3"))
        XCTAssertTrue(quiet.contains("+line ten"))
        XCTAssertEqual(FilePatch(plain).changedLines.count, 4)
        XCTAssertEqual(FilePatch(quiet).changedLines.count, 2)
    }

    func testFilePatchSelectionKeepsUnselectedLinesAsContext() throws {
        let text = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -10,2 +10,3 @@\n x\n+y\n z\n"
        let patch = FilePatch(text)
        XCTAssertEqual(patch.hunks.map(\.headerIndex), [3, 8])
        XCTAssertEqual(patch.changedLines, [5, 6, 10])
        let forward = try patch.patch(selecting: [6], reverse: false)
        XCTAssertEqual(forward, "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,4 @@\n a\n b\n+B\n c\n")
        let reverse = try patch.patch(selecting: [5, 10], reverse: true)
        XCTAssertEqual(reverse,
                       "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,4 +1,3 @@\n a\n-b\n B\n c\n@@ -11,2 +10,3 @@\n x\n+y\n z\n")
        XCTAssertThrowsError(try patch.patch(selecting: [4], reverse: false))
        let created = FilePatch("diff --git a/n b/n\nnew file mode 100644\n--- /dev/null\n+++ b/n\n@@ -0,0 +1,2 @@\n+1\n+2\n")
        XCTAssertThrowsError(try created.patch(selecting: [5], reverse: false))
        XCTAssertNoThrow(try created.patch(selecting: [5, 6], reverse: false))
    }
}
