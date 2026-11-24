import Foundation
import RatelGitCore
import XCTest
@testable import RatelGit

final class PureLogicTests: XCTestCase {
    private func branch(_ name: String, _ kind: ReferenceKind = .local) -> Reference {
        let prefix = kind == .local ? "refs/heads/" : "refs/remotes/"
        return Reference(id: prefix + name, name: name, kind: kind)
    }

    func testBranchTreeFoldersAndRemotes() {
        let local = BranchTree.build(["main", "feature/x/y", "feature/x/z", "feature/a", "Zeta", "alpha"].map { branch($0) })
        XCTAssertEqual(local.map(\.name), ["feature", "alpha", "main", "Zeta"])
        let feature = local[0]
        XCTAssertTrue(feature.isFolder)
        XCTAssertNil(feature.reference)
        XCTAssertEqual(feature.children.map(\.name), ["x", "a"])
        XCTAssertEqual(feature.children[0].children.map(\.path), ["feature/x/y", "feature/x/z"])
        XCTAssertEqual(feature.references.map(\.id).sorted(),
                       ["refs/heads/feature/a", "refs/heads/feature/x/y", "refs/heads/feature/x/z"])
        XCTAssertNil(local[2].childNodes)

        let remote = BranchTree.build(["origin/main", "origin/feature/x", "upstream/main"].map { branch($0, .remote) })
        XCTAssertEqual(remote.map(\.name), ["origin", "upstream"])
        XCTAssertEqual(remote[0].children.map(\.name), ["feature", "main"])
        XCTAssertNotEqual(remote[0].id, BranchTree.build([branch("origin/x")]).first?.id, "local and remote folders differ")
    }

    func testWordDiffMarksOnlyChangedWords() throws {
        let changes = try XCTUnwrap(WordDiff.changes(old: "let value = compute(1, 2)", new: "let total = compute(1, 3)"))
        XCTAssertEqual(changes.removed, [4..<9, 23..<24])
        XCTAssertEqual(changes.added, [4..<9, 23..<24])
        let inserted = try XCTUnwrap(WordDiff.changes(old: "print(a)", new: "print(a, b)"))
        XCTAssertEqual(inserted.removed, [])
        XCTAssertEqual(inserted.added, [7..<10])
        let same = try XCTUnwrap(WordDiff.changes(old: "같은 줄", new: "같은 줄"))
        XCTAssertTrue(same.removed.isEmpty && same.added.isEmpty)
        let hangul = try XCTUnwrap(WordDiff.changes(old: "안녕 세상 이야기", new: "안녕 우주 이야기"))
        XCTAssertEqual(hangul.added, [3..<5])
        XCTAssertNil(WordDiff.changes(old: "completely different", new: "nothing shared here"))
    }

    func testFuzzyMatchRanksBoundariesAndPrefixes() {
        XCTAssertNotNil(FuzzyMatch.score("fxy", in: "feature/x/y"))
        XCTAssertNil(FuzzyMatch.score("yxf", in: "feature/x/y"))
        XCTAssertEqual(FuzzyMatch.score("", in: "anything"), 0)
        XCTAssertNotNil(FuzzyMatch.score("FEAT", in: "feature"))
        let ranked = FuzzyMatch.rank(["src-main-helper", "main", "domain", "maintenance"], query: "main") { $0 }
        XCTAssertEqual(ranked.first, "main")
        XCTAssertEqual(ranked.last, "domain", "a match inside a word ranks below word starts")
        XCTAssertEqual(FuzzyMatch.rank(["fix/login", "feature/login", "docs"], query: "flog") { $0 },
                       ["fix/login", "feature/login"])
        XCTAssertGreaterThan(FuzzyMatch.score("rg", in: "ratel-git") ?? 0, FuzzyMatch.score("rg", in: "larger") ?? 0)
    }

    func testProjectStorePersistsAndMigratesRecentList() {
        let legacy = MemoryDefaults([ProjectStore.legacyKey: ["/a", "/b", "/a"]])
        let store = ProjectStore(defaults: legacy)
        XCTAssertEqual(store.load(), ["/a", "/b"])
        XCTAssertEqual(legacy.stringArray(forKey: ProjectStore.key), ["/a", "/b"])
        store.save(["/b", "/c", "/b", ""])
        XCTAssertEqual(ProjectStore(defaults: legacy).load(), ["/b", "/c"], "the new key wins once written")
        XCTAssertEqual(ProjectStore(defaults: MemoryDefaults()).load(), [])
    }

    func testHistoryFilterToggling() {
        let first = branch("feature/a")
        let second = branch("feature/b")
        let folder = HistoryFilter.none.toggling([first, second])
        XCTAssertEqual(folder.refs, [first.id, second.id])
        XCTAssertEqual(folder.toggling([first, second]), .none, "a fully selected folder turns off")
        XCTAssertEqual(HistoryFilter(refs: [first.id]).toggling([first, second]).refs, [first.id, second.id])
        XCTAssertEqual(HistoryFilter.none.toggledCurrentBranch().scope, .refs(["HEAD"]))
        XCTAssertEqual(HistoryFilter.none.toggledCurrentBranch().toggledCurrentBranch(), .none)
        XCTAssertEqual(HistoryFilter.none.scope, .all)
        XCTAssertEqual(folder.pruned(to: [first]).refs, [first.id])
        XCTAssertEqual(folder.renaming(first.id, to: "refs/heads/feature/c").refs, ["refs/heads/feature/c", second.id])
    }

    @MainActor
    func testProjectListSurvivesRelaunchAndMissingFolders() async throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let repo = try makeSampleRepository(at: root)
        let linked = root.appendingPathComponent("linked")
        try shell(repo, "worktree", "add", "-q", linked.path, "side")
        let missing = root.appendingPathComponent("gone").path
        let defaults = MemoryDefaults([ProjectStore.legacyKey: [linked.path, missing]])

        let model = BrowserModel(store: ProjectStore(defaults: defaults))
        let deadline = ContinuousClock.now + .seconds(10)
        while model.projects.contains(where: { $0.state == .loading }) || model.active == nil || model.loading {
            guard ContinuousClock.now < deadline else { return XCTFail("projects did not load") }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(model.projects.map(\.path), [repo.path, missing], "a linked worktree resolves to its repository")
        XCTAssertEqual(model.projects[0].worktrees.count, 2)
        XCTAssertTrue(model.projects[1].isUnavailable)
        XCTAssertEqual(model.active?.path, repo.path)
        XCTAssertEqual(defaults.stringArray(forKey: ProjectStore.key), [repo.path, missing])

        model.removeProject(model.projects[1])
        let relaunched = BrowserModel(store: ProjectStore(defaults: defaults))
        XCTAssertEqual(relaunched.projects.map(\.path), [repo.path])
    }
}
