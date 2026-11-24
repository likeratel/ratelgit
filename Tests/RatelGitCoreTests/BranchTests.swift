import Foundation
import RatelGitCore
import XCTest
@testable import RatelGit

final class BranchTests: XCTestCase {
    private func ref(_ client: Git, _ id: String) throws -> Reference {
        try XCTUnwrap(client.references().first { $0.id == id }, id)
    }

    func testRenameAndDeleteRefuseUnmergedWithoutForce() throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let repo = try makeSampleRepository(at: root)
        let client = Git(path: repo.path)

        try client.execute(.renameBranch(try ref(client, "refs/heads/fix/login"), to: "fix/sign-in"))
        XCTAssertNotNil(try client.references().first { $0.id == "refs/heads/fix/sign-in" })
        XCTAssertNil(try client.references().first { $0.id == "refs/heads/fix/login" })
        for bad in ["", "-x", "has space", "bad..name", "ends.lock"] {
            XCTAssertThrowsError(try client.execute(.renameBranch(try ref(client, "refs/heads/side"), to: bad)), bad)
        }

        let unmerged = try ref(client, "refs/heads/fix/sign-in")
        XCTAssertThrowsError(try client.execute(.deleteBranch(unmerged, force: false))) { error in
            XCTAssertTrue(error.localizedDescription.contains("not fully merged"), error.localizedDescription)
        }
        try client.execute(.deleteBranch(unmerged, force: true))
        XCTAssertNil(try client.references().first { $0.id == unmerged.id })
        try client.execute(.deleteBranch(try ref(client, "refs/heads/side"), force: false))
        XCTAssertThrowsError(try client.execute(.deleteBranch(try ref(client, "refs/heads/main"), force: true)),
                             "the checked-out branch cannot be deleted")
        let tag = try ref(client, "refs/tags/v1.0")
        XCTAssertThrowsError(try client.execute(.deleteBranch(tag, force: true)))
    }

    func testAddWorktreeAndCheckOutRemoteBranch() throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let repo = try makeSampleRepository(at: root)
        let client = Git(path: repo.path)
        let location = root.appendingPathComponent("sample-feature")
        let feature = try ref(client, "refs/heads/feature/x/y")
        try client.execute(.addWorktree(feature, path: location.path))
        let trees = try client.worktrees()
        XCTAssertEqual(trees.last?.branch, "feature/x/y")
        XCTAssertEqual(trees.last?.path, location.path)
        let checkedOut = try ref(client, "refs/heads/feature/x/y")
        XCTAssertEqual(checkedOut.worktreePath, location.path)
        XCTAssertFalse(checkedOut.isHead)
        XCTAssertTrue(try ref(client, "refs/heads/main").isHead)
        XCTAssertTrue(try ref(Git(path: location.path), "refs/heads/feature/x/y").isHead)
        XCTAssertThrowsError(try client.execute(.addWorktree(try ref(client, "refs/heads/side"), path: "relative/path")))
        XCTAssertThrowsError(try client.execute(.addWorktree(try ref(client, "refs/heads/side"), path: location.path)),
                             "a non-empty folder is refused")
        XCTAssertThrowsError(try client.execute(.switchBranch(checkedOut)), "busy in another worktree")

        try shell(repo, "branch", "-q", "-D", "fix/login")
        try shell(repo, "push", "-q", "origin", "main:fix/login")
        try shell(repo, "fetch", "-q", "origin")
        let remote = try ref(client, "refs/remotes/origin/fix/login")
        XCTAssertEqual(try client.trackingName(for: remote), "fix/login")
        try client.execute(.checkoutRemote(remote))
        XCTAssertEqual(try client.tracking()?.branch, "fix/login")
        XCTAssertEqual(try client.tracking()?.remote, "origin")
        XCTAssertThrowsError(try client.execute(.checkoutRemote(remote)), "the local branch already exists")
    }

    func testMergeConflictReportsStateAndAbortRestores() throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        try shell(root, "init", "-q", "-b", "main")
        try put("base\n", in: root, "conflict.txt")
        try commitAll(root, "Base")
        try shell(root, "switch", "-q", "-c", "side")
        try put("side\n", in: root, "conflict.txt")
        try commitAll(root, "Side")
        try shell(root, "switch", "-q", "main")
        try put("main\n", in: root, "conflict.txt")
        try commitAll(root, "Main")
        let client = Git(path: root.path)
        let side = try ref(client, "refs/heads/side")

        XCTAssertNil(try client.operationInProgress())
        XCTAssertThrowsError(try client.execute(.merge(side))) { error in
            XCTAssertTrue(error.localizedDescription.contains("CONFLICT"), error.localizedDescription)
        }
        XCTAssertEqual(try client.operationInProgress(), .merge)
        XCTAssertEqual(try client.workingFiles().map(\.status), ["U"])
        XCTAssertThrowsError(try client.execute(.discard(try XCTUnwrap(client.workingFiles().first))))
        XCTAssertThrowsError(try client.execute(.abort(.rebase)))
        try client.execute(.abort(.merge))
        XCTAssertNil(try client.operationInProgress())
        XCTAssertEqual(try read(root, "conflict.txt"), "main\n")

        XCTAssertThrowsError(try client.execute(.rebase(onto: side)))
        XCTAssertEqual(try client.operationInProgress(), .rebase)
        try client.execute(.abort(.rebase))
        XCTAssertNil(try client.operationInProgress())
        XCTAssertEqual(try gitOutput(root, ["log", "-1", "--format=%s"]), "Main\n")

        try put("clean\n", in: root, "other.txt")
        try commitAll(root, "Other")
        try shell(root, "switch", "-q", "-c", "topic")
        try put("topic\n", in: root, "topic.txt")
        try commitAll(root, "Topic")
        try shell(root, "switch", "-q", "main")
        try client.execute(.merge(try ref(client, "refs/heads/topic")))
        XCTAssertEqual(try gitOutput(root, ["log", "-1", "--format=%s"]), "Topic\n", "fast-forward when possible")
    }

    @MainActor
    func testModelAsksBeforeForceDeleteAndShowsStoppedMerge() async throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let repo = try makeSampleRepository(at: root)
        try shell(repo, "switch", "-q", "-c", "clash", "main~2")
        try put("let value = 3\n", in: repo, "Sources/app.swift")
        try commitAll(repo, "Clashing value")
        try shell(repo, "switch", "-q", "main")
        let model = BrowserModel(store: ProjectStore(defaults: MemoryDefaults()))
        model.open(repo)
        try await waitUntilIdle(model)
        let login = try XCTUnwrap(model.references.first { $0.id == "refs/heads/fix/login" })
        model.execute(.deleteBranch(login, force: false))
        try await waitUntilIdle(model)
        guard case .deleteBranch(let target, true)? = model.confirmation?.action else {
            return XCTFail("expected a force-delete confirmation")
        }
        XCTAssertEqual(target.id, login.id)
        XCTAssertNotNil(model.references.first { $0.id == login.id }, "nothing is deleted before confirming")
        model.run(try XCTUnwrap(model.confirmation))
        try await waitUntilIdle(model)
        XCTAssertNil(model.references.first { $0.id == login.id })

        model.execute(.merge(try XCTUnwrap(model.references.first { $0.id == "refs/heads/clash" })))
        try await waitUntilIdle(model, expectError: true)
        XCTAssertTrue(model.error?.contains("Merge failed") == true)
        XCTAssertEqual(model.operation, .merge)
        XCTAssertEqual(model.files.map(\.status), ["U"])
        model.dismissError()
        model.execute(.abort(.merge))
        try await waitUntilIdle(model)
        XCTAssertNil(model.operation)
        XCTAssertTrue(model.files.isEmpty)
    }

    func testStashDropChecksTheIndexStillMatches() throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        try shell(root, "init", "-q", "-b", "main")
        try put("base\n", in: root, "a.txt")
        try commitAll(root, "Base")
        let client = Git(path: root.path)
        try put("first\n", in: root, "a.txt")
        try client.execute(.stash("first"))
        let first = try XCTUnwrap(client.references().first { $0.kind == .stash })
        try put("second\n", in: root, "a.txt")
        try client.execute(.stash("second"))
        XCTAssertThrowsError(try client.execute(.dropStash(first)), "stash@{0} now names a different stash")
        let current = try XCTUnwrap(client.references().first { $0.kind == .stash && $0.name.contains("first") })
        try client.execute(.dropStash(current))
        let remaining = try client.references().filter { $0.kind == .stash }
        XCTAssertEqual(remaining.count, 1)
        XCTAssertTrue(remaining[0].name.contains("second"))
    }
}
