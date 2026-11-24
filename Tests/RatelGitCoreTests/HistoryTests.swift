import Foundation
import RatelGitCore
import XCTest
@testable import RatelGit

final class HistoryTests: XCTestCase {
    func testAllRefsGraphAndFilterUnion() throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let repo = try makeSampleRepository(at: root)
        let client = Git(path: repo.path)

        let all = try client.history(.all)
        let titles = Set(all.map(\.title))
        XCTAssertTrue(titles.isSuperset(of: ["Extend nested feature", "Fix login redirect", "Add side notes",
                                             "Initial commit"]))
        XCTAssertEqual(all.count, Set(all.compactMap(\.hash)).count, "each commit appears once")
        XCTAssertEqual(all.map(\.id), Array(all.indices))
        XCTAssertTrue(all.contains { $0.isHead && $0.labels.contains("HEAD -> main") })
        XCTAssertTrue(all.contains { $0.labels.contains("tag: v1.0") })
        XCTAssertTrue(all.contains { $0.labels.contains("origin/feature/x/y") })

        let nested = try client.history(.refs(["refs/heads/feature/x/y"]))
        XCTAssertEqual(nested.first?.title, "Extend nested feature")
        XCTAssertFalse(nested.contains { $0.title == "Fix login redirect" })
        let union = try client.history(.refs(["refs/heads/feature/x/y", "refs/heads/fix/login"]))
        let unionTitles = Set(union.map(\.title))
        XCTAssertTrue(unionTitles.isSuperset(of: ["Extend nested feature", "Fix login redirect", "Bump the value"]))
        XCTAssertEqual(union.count, Set(nested.compactMap(\.hash) + (try client.history(.refs(["refs/heads/fix/login"])))
            .compactMap(\.hash)).count)

        XCTAssertFalse(try client.headHidden(by: .all))
        XCTAssertFalse(try client.headHidden(by: .refs(["refs/heads/feature/x/y"])), "main is an ancestor of the feature")
        try shell(repo, "switch", "-q", "fix/login")
        XCTAssertTrue(try client.headHidden(by: .refs(["refs/heads/feature/x/y"])))
        XCTAssertFalse(try client.headHidden(by: .refs(["HEAD"])))
        XCTAssertThrowsError(try client.history(.refs(["--all"])))
        XCTAssertTrue(try client.history(.refs(["refs/heads/deleted"])).isEmpty)
    }

    func testPagesContinueOneListingAndKeepLanesOpen() throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let repo = try makeSampleRepository(at: root)
        let client = Git(path: repo.path)
        let full = try client.history(.all)
        let first = try client.history(.all, skip: 0, limit: 3)
        let second = try client.history(.all, skip: 3, limit: 3)
        let rest = try client.history(.all, skip: 6, limit: 100)
        XCTAssertEqual((first + second + rest).compactMap(\.hash), full.compactMap(\.hash))
        XCTAssertEqual(second.first?.id, 3)

        let state = HistoryState.first(first, headHidden: false, pageSize: 3)
        XCTAssertFalse(state.complete)
        let last = try XCTUnwrap(state.layout.rows.last)
        XCTAssertFalse(last.outgoing.isEmpty, "a parent on the next page keeps its lane running down")
        let grown = state.appending(second, pageSize: 3).appending(rest, pageSize: 3)
        XCTAssertTrue(grown.complete)
        XCTAssertEqual(grown.token, state.token)
        let whole = CommitGraph(full)
        XCTAssertEqual(grown.layout.rows, whole.rows)
        XCTAssertEqual(Array(whole.rows.prefix(3)), state.layout.rows, "earlier rows do not move when a page arrives")
        XCTAssertEqual(whole.rows.last?.outgoing.isEmpty, true)
        assertContinuous(whole)
    }

    func testGraphWithManyHeadsStaysContinuous() throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let repo = try makeSampleRepository(at: root)
        for index in 0..<4 {
            try shell(repo, "switch", "-q", "-c", "topic/\(index)", "main~\(index % 2)")
            try put("topic \(index)\n", in: repo, "topic\(index).txt")
            try commitAll(repo, "Topic \(index)")
        }
        let layout = CommitGraph(try Git(path: repo.path).history(.all))
        assertContinuous(layout)
        XCTAssertGreaterThanOrEqual(layout.columns, 3)
        XCTAssertEqual(layout.rows.filter { $0.commit.title.hasPrefix("Topic ") }.count, 4)
        for row in layout.rows {
            let parentEdges = row.outgoing.filter { $0.from == row.lane }
            XCTAssertEqual(parentEdges.count, row.commit.parents.count, row.commit.title)
        }
    }

    @MainActor
    func testFiltersStayWithTheirProjectAndPagesLoad() async throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let first = try makeSampleRepository(at: root, name: "first")
        let second = try makeSampleRepository(at: root, name: "second")
        try shell(first, "switch", "-q", "-c", "other")
        try shell(first, "commit", "-q", "--allow-empty", "-m", "Other only")
        try shell(first, "switch", "-q", "main")
        let model = BrowserModel(store: ProjectStore(defaults: MemoryDefaults()))
        model.open(first)
        try await waitUntilIdle(model)
        XCTAssertTrue(model.graph.contains { $0.title == "Other only" })
        try await waitUntilIdle(model)
        let nested = try XCTUnwrap(model.references.first { $0.id == "refs/heads/feature/x/y" })
        let login = try XCTUnwrap(model.references.first { $0.id == "refs/heads/fix/login" })
        model.toggleFilter([nested])
        model.toggleFilter([login])
        try await waitUntilIdle(model)
        XCTAssertEqual(model.filter.refs, [nested.id, login.id])
        XCTAssertTrue(model.graph.contains { $0.title == "Fix login redirect" })
        XCTAssertFalse(model.graph.contains { $0.title == "Other only" })

        model.open(second)
        try await waitUntilIdle(model)
        XCTAssertTrue(model.filter.isEmpty)
        XCTAssertEqual(model.projects.map(\.name), ["first", "second"])
        let back = try XCTUnwrap(model.projects.first?.worktrees.first)
        model.select(back)
        try await waitUntilIdle(model)
        XCTAssertEqual(model.filter.refs, [nested.id, login.id])
        model.toggleCurrentBranchOnly()
        try await waitUntilIdle(model)
        XCTAssertTrue(model.filter.isCurrentBranchOnly)
        XCTAssertEqual(model.graph.first?.title, "Merge branch 'side'")
        model.clearFilter()
        try await waitUntilIdle(model)
        XCTAssertTrue(model.graph.contains { $0.title == "Fix login redirect" })
        XCTAssertTrue(model.history.complete)
    }

    @MainActor
    func testModelLoadsTheNextPageAtTheEnd() async throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let total = Git.historyPageSize + 20
        try makeLongHistory(at: root, count: total)
        let model = BrowserModel(store: ProjectStore(defaults: MemoryDefaults()))
        model.open(root)
        try await waitUntilIdle(model)
        XCTAssertEqual(model.graph.count, Git.historyPageSize)
        XCTAssertFalse(model.history.complete)
        XCTAssertEqual(model.history.layout.rows.last?.outgoing.count, 1, "the lane runs on past the page")
        model.loadMoreHistory()
        model.loadMoreHistory()
        try await waitUntilIdle(model)
        XCTAssertEqual(model.graph.count, total)
        XCTAssertEqual(model.graph.last?.title, "Commit 1")
        XCTAssertTrue(model.history.complete)
        XCTAssertEqual(model.history.layout.rows.count, total)
        XCTAssertEqual(Set(model.history.layout.rows.map(\.lane)), [0])
    }

    /// Every lane at the bottom of a row continues at the top of the next one.
    private func assertContinuous(_ layout: CommitGraph, file: StaticString = #filePath, line: UInt = #line) {
        for (above, below) in zip(layout.rows, layout.rows.dropFirst()) {
            let bottom = Set(above.outgoing.map(\.to))
            let top = Set(below.incoming.map(\.from) + below.outgoing.filter { $0.from != below.lane }.map(\.from))
            XCTAssertEqual(bottom, top, "lanes break below \(above.commit.title)", file: file, line: line)
            if below.incoming.isEmpty {
                XCTAssertEqual(below.lane, bottom.count, "a new head opens on the right", file: file, line: line)
            }
        }
    }
}
