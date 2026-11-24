import Foundation
import RatelGitCore
import XCTest
@testable import RatelGit

final class WorktreeTests: XCTestCase {
    func testSwitchBetweenWorktreesWithDifferentHistoryAndChanges() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let primary = root.appendingPathComponent("primary")
        let linked = root.appendingPathComponent("linked worktree")
        try git(root, "init", "-b", "main", primary.path)
        try write("base\n", to: primary, file: "shared.txt")
        try git(primary, "add", ".")
        try git(primary, "commit", "-m", "Base")
        try git(primary, "worktree", "add", "-b", "feature", linked.path)
        try write("feature commit\n", to: linked, file: "feature.txt")
        try git(linked, "add", "feature.txt")
        try git(linked, "commit", "-m", "Feature commit")
        try git(linked, "tag", "-a", "v1", "-m", "Version")
        try git(primary, "update-ref", "refs/remotes/origin/feature", "refs/heads/feature")
        try write("stashed\n", to: linked, file: "shared.txt")
        try git(linked, "stash", "push", "-m", "Feature stash")

        try write("main working\n", to: primary, file: "shared.txt")
        try write("feature staged\n", to: linked, file: "shared.txt")
        try git(linked, "add", "shared.txt")
        try write("feature unstaged\n", to: linked, file: "shared.txt")
        try write("new file\n", to: linked, file: "new [file].txt")

        let trees = try Git(path: linked.path).worktrees()
        XCTAssertEqual(trees.map(\.branch), ["main", "feature"])
        XCTAssertEqual(trees.map(\.changes), [1, 2])
        let main = Git(path: trees[0].path)
        let feature = Git(path: trees[1].path)
        XCTAssertTrue(try main.graph().first?.subject.hasSuffix("Base") == true)
        let tip = try XCTUnwrap(feature.graph().first)
        XCTAssertTrue(tip.subject.hasSuffix("Feature commit"))
        let hash = try XCTUnwrap(tip.hash)
        let commitFile = try XCTUnwrap(feature.commitFiles(hash).first)
        XCTAssertEqual(commitFile.path, "feature.txt")
        XCTAssertTrue(try feature.diff(commitFile, commit: hash).contains("+feature commit"))
        XCTAssertTrue(try main.diff(XCTUnwrap(main.workingFiles().first)).contains("+main working"))
        for (kind, content) in [(ChangeKind.staged, "+feature staged"), (.unstaged, "+feature unstaged"), (.untracked, "+new file")] {
            let file = try XCTUnwrap(feature.workingFiles().first { $0.kind == kind })
            XCTAssertTrue(try feature.diff(file).contains(content))
        }
        let refs = try main.references()
        XCTAssertEqual(Set(refs.map(\.group)), ["Local branches", "Remote branches", "Tags", "Stashes"])
        for ref in ["refs/heads/feature", "refs/remotes/origin/feature", "refs/tags/v1"] {
            XCTAssertEqual(try main.graph(ref: ref).first?.hash, hash)
        }
        XCTAssertFalse(try main.graph(ref: "stash@{0}").isEmpty)

        try git(linked, "checkout", "--detach")
        XCTAssertEqual(try main.worktrees().last?.branch, "Detached HEAD")
        XCTAssertEqual(try feature.graph().first?.hash, hash)
    }

    func testUnbornRepositoryAndMergeGraph() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try git(root, "init", "-b", "main")
        let client = Git(path: root.path)
        XCTAssertEqual(try client.worktrees().first?.branch, "main")
        XCTAssertTrue(try client.graph().isEmpty)
        XCTAssertTrue(try client.workingFiles().isEmpty)
        try git(root, "commit", "--allow-empty", "-m", "Base")
        try git(root, "checkout", "-b", "side")
        try write("side\n", to: root, file: "side.txt")
        try git(root, "add", ".")
        try git(root, "commit", "-m", "Side")
        try git(root, "checkout", "main")
        try write("main\n", to: root, file: "main.txt")
        try git(root, "add", ".")
        try git(root, "commit", "-m", "Main")
        try git(root, "merge", "--no-ff", "--no-edit", "side")
        let graph = try client.graph()
        XCTAssertEqual(graph.compactMap(\.hash).count, 4)
        let layout = CommitGraph(graph)
        XCTAssertEqual(layout.columns, 2)
        XCTAssertEqual(layout.rows.first?.outgoing.count, 2)
        XCTAssertEqual(layout.rows.last?.outgoing.count, 0)
        XCTAssertTrue(graph.contains { $0.hash == nil && $0.lanes.contains("\\") })
        let merge = try XCTUnwrap(graph.first?.hash)
        let files = try client.commitFiles(merge)
        XCTAssertEqual(files.map(\.path), ["side.txt"])
        XCTAssertTrue(try client.diff(XCTUnwrap(files.first), commit: merge).contains("+side"))
    }

    @MainActor
    func testBrowserKeepsLatestWorktreeAfterRapidSwitches() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try git(root, "init", "-b", "main")
        try git(root, "commit", "--allow-empty", "-m", "Base")
        let linked = root.appendingPathComponent("nested worktree")
        try git(root, "worktree", "add", "-b", "feature", linked.path)
        try git(linked, "commit", "--allow-empty", "-m", "Feature")
        try write("feature draft\n", to: linked, file: "draft.txt")

        let model = BrowserModel()
        model.open(linked)
        try await finishLoading(model)
        XCTAssertEqual(model.active?.branch, "feature")
        model.move(-1)
        try await finishLoading(model)
        XCTAssertEqual(model.active?.branch, "main")
        XCTAssertTrue(model.graph.first?.subject.hasSuffix("Base") == true)
        model.move(1)
        model.move(-1)
        model.move(1)
        try await finishLoading(model)
        XCTAssertEqual(model.active?.branch, "feature")
        XCTAssertTrue(model.graph.first?.subject.hasSuffix("Feature") == true)
        let file = try XCTUnwrap(model.files.first)
        XCTAssertEqual(file.path, "draft.txt")
        model.selectFile(file)
        try await finishLoading(model)
        XCTAssertTrue(model.patch.contains("+feature draft"))
    }

    @MainActor
    func testMutationsAndDraftStayWithTheirWorktree() async throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        try git(root, "init", "-b", "main")
        try configureIdentity(root)
        let main = Git(path: root.path)
        try write("first\n", to: root, file: "literal [file].txt")
        try main.execute(.stage(try XCTUnwrap(main.workingFiles().first)))
        try write("second\n", to: root, file: "literal [file].txt")
        try main.execute(.unstage(try XCTUnwrap(main.workingFiles().first { $0.kind == .staged })))
        XCTAssertEqual(try main.workingFiles().map(\.kind), [.untracked])
        try main.execute(.stage(try XCTUnwrap(main.workingFiles().first)))
        try main.execute(.commit("Initial from app"))

        let feature = root.deletingLastPathComponent().appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: feature) }
        try git(root, "worktree", "add", "-b", "feature", feature.path)
        try write("feature only\n", to: feature, file: "draft.txt")
        try write("main only\n", to: root, file: "draft.txt")

        let model = BrowserModel()
        model.open(feature)
        try await finishLoading(model)
        model.draft = "Feature draft"
        model.execute(.stage(try XCTUnwrap(model.files.first)))
        model.move(-1)
        XCTAssertEqual(model.active?.branch, "feature")
        try await finishLoading(model)
        XCTAssertEqual(model.files.map(\.kind), [.staged])
        model.move(-1)
        try await finishLoading(model)
        XCTAssertEqual(model.active?.branch, "main")
        XCTAssertEqual(model.draft, "")
        XCTAssertEqual(model.files.map(\.kind), [.untracked])
        let taken = try XCTUnwrap(main.references().first { $0.name == "feature" })
        XCTAssertThrowsError(try main.execute(.switchBranch(taken)))
        model.move(1)
        try await finishLoading(model)
        XCTAssertEqual(model.draft, "Feature draft")
        XCTAssertEqual(model.files.map(\.kind), [.staged])
        model.execute(.commit(model.draft))
        try await finishLoading(model)
        XCTAssertEqual(model.draft, "")
        XCTAssertEqual(model.graph.first?.title, "Feature draft")
        XCTAssertEqual(try main.workingFiles().map(\.kind), [.untracked])

        try main.execute(.createBranch("scratch"))
        XCTAssertEqual(try main.worktrees().first?.branch, "scratch")
        try main.execute(.stash("save draft"))
        XCTAssertTrue(try main.workingFiles().isEmpty)
        let stash = try XCTUnwrap(main.references().first { $0.group == "Stashes" })
        try write("different draft\n", to: root, file: "later.txt")
        try main.execute(.stash("newer stash"))
        try main.execute(.applyStash(stash))
        XCTAssertEqual(try main.workingFiles().map(\.path), ["draft.txt"])
    }

    func testFetchPullAndPushAgainstLocalRemote() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let remote = root.appendingPathComponent("remote.git")
        let first = root.appendingPathComponent("first")
        let second = root.appendingPathComponent("second")
        try git(root, "init", "--bare", "-b", "main", remote.path)
        try git(root, "clone", remote.path, first.path)
        try configureIdentity(first)
        try git(first, "commit", "--allow-empty", "-m", "Base")
        let client = Git(path: first.path)
        XCTAssertNil(try client.tracking())
        XCTAssertThrowsError(try client.execute(.push))
        try git(first, "push", "-u", "origin", "main")
        try git(root, "clone", remote.path, second.path)
        try configureIdentity(second)
        try git(second, "commit", "--allow-empty", "-m", "Upstream")
        try git(second, "push")
        try client.execute(.fetch)
        XCTAssertEqual(try client.tracking()?.behind, 1)
        try client.execute(.pull)
        XCTAssertEqual(try client.graph().first?.title, "Upstream")
        try git(first, "commit", "--allow-empty", "-m", "Local")
        XCTAssertEqual(try client.tracking()?.ahead, 1)
        try client.execute(.push)
        XCTAssertEqual(try client.tracking()?.ahead, 0)
        try git(second, "commit", "--allow-empty", "-m", "Other local")
        let divergent = Git(path: second.path)
        XCTAssertThrowsError(try divergent.execute(.pull))
        XCTAssertEqual(try divergent.graph().first?.title, "Other local")
    }

    func testConflictShowsOneUnmergedFileAndStageResolvesIt() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        try git(root, "init", "-b", "main")
        try write("base\n", to: root, file: "conflict.txt")
        try git(root, "add", ".")
        try git(root, "commit", "-m", "Base")
        try git(root, "checkout", "-b", "side")
        try write("side\n", to: root, file: "conflict.txt")
        try git(root, "commit", "-am", "Side")
        try git(root, "checkout", "main")
        try write("main\n", to: root, file: "conflict.txt")
        try git(root, "commit", "-am", "Main")
        XCTAssertThrowsError(try git(root, "merge", "side"))

        let client = Git(path: root.path)
        let files = try client.workingFiles()
        XCTAssertEqual(files.map(\.status), ["U"])
        try write("resolved\n", to: root, file: "conflict.txt")
        try client.execute(.stage(try XCTUnwrap(files.first)))
        XCTAssertEqual(try client.workingFiles().map(\.kind), [.staged])
    }

    func testPatchLineNumbersAndSplitAlignment() {
        let patch = "@@ -10,3 +20,4 @@\n unchanged\n-old\n+new\n+extra\n last\n"
        let document = PatchDocument(patch)
        XCTAssertEqual(document.lines.map(\.old), [nil, 10, 11, nil, nil, 12])
        XCTAssertEqual(document.lines.map(\.new), [nil, 20, nil, 21, 22, 23])
        XCTAssertEqual(document.splitRows[2].left?.text, "old")
        XCTAssertEqual(document.splitRows[2].right?.text, "new")
        XCTAssertNil(document.splitRows[3].left)
    }

    private func temporaryDirectory() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func configureIdentity(_ directory: URL) throws {
        try git(directory, "config", "user.name", "RatelGit Test")
        try git(directory, "config", "user.email", "test@example.invalid")
        try git(directory, "config", "commit.gpgsign", "false")
    }

    @MainActor
    private func finishLoading(_ model: BrowserModel) async throws {
        let deadline = ContinuousClock.now + .seconds(10)
        while (model.loading || model.mutation != nil) && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertFalse(model.loading)
        XCTAssertNil(model.mutation)
        XCTAssertNil(model.error)
    }

    private func write(_ text: String, to directory: URL, file: String) throws {
        try text.write(to: directory.appendingPathComponent(file), atomically: true, encoding: .utf8)
    }

    private func git(_ directory: URL, _ args: String...) throws {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["-C", directory.path, "-c", "user.name=RatelGit Test",
                             "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false",
                             "-c", "tag.gpgsign=false"] + args
        process.standardOutput = output
        process.standardError = output
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw NSError(domain: "GitFixture", code: Int(process.terminationStatus),
                          userInfo: [NSLocalizedDescriptionKey: String(decoding: data, as: UTF8.self)])
        }
    }
}
