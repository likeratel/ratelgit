import Foundation
import RatelGitCore

/// Loaded history pages and their lane layout. Each change returns a new value.
struct HistoryState: Sendable {
    let lines: [GraphLine]
    let layout: CommitGraph
    /// True once a page came back shorter than the page size.
    let complete: Bool
    /// The filter hides the commit the worktree has checked out.
    let headHidden: Bool
    let token: UUID

    static let empty = HistoryState(lines: [], layout: CommitGraph([]), complete: true, headHidden: false, token: UUID())

    static func first(_ page: [GraphLine], headHidden: Bool, pageSize: Int) -> HistoryState {
        HistoryState(lines: page, layout: CommitGraph(page), complete: page.count < pageSize,
                     headHidden: headHidden, token: UUID())
    }

    /// Layout is rebuilt over every loaded line so lanes that crossed the page boundary keep going.
    func appending(_ page: [GraphLine], pageSize: Int) -> HistoryState {
        let combined = lines + page
        return HistoryState(lines: combined, layout: CommitGraph(combined), complete: page.count < pageSize,
                            headHidden: headHidden, token: token)
    }
}

/// Which refs a project's history is limited to. `HEAD` stands for the selected worktree's HEAD.
struct HistoryFilter: Hashable, Sendable {
    static let head = "HEAD"
    let refs: Set<String>

    static let none = HistoryFilter(refs: [])

    var isEmpty: Bool { refs.isEmpty }
    var isCurrentBranchOnly: Bool { refs == [Self.head] }
    var scope: HistoryScope { refs.isEmpty ? .all : .refs(refs.sorted()) }

    func contains(_ ref: Reference) -> Bool { refs.contains(ref.id) }

    /// Turns a branch, or every branch in a folder, on or off. A folder that is fully on turns off.
    func toggling(_ group: [Reference]) -> HistoryFilter {
        let ids = Set(group.map(\.id))
        let base = refs.subtracting([Self.head])
        return HistoryFilter(refs: ids.isSubset(of: base) ? base.subtracting(ids) : base.union(ids))
    }

    func removing(_ ref: String) -> HistoryFilter { HistoryFilter(refs: refs.subtracting([ref])) }

    func toggledCurrentBranch() -> HistoryFilter {
        isCurrentBranchOnly ? .none : HistoryFilter(refs: [Self.head])
    }

    /// Drops refs that no longer exist, for example after a branch was deleted.
    func pruned(to references: [Reference]) -> HistoryFilter {
        let existing = Set(references.map(\.id)).union([Self.head])
        return HistoryFilter(refs: refs.intersection(existing))
    }

    func renaming(_ old: String, to new: String) -> HistoryFilter {
        refs.contains(old) ? HistoryFilter(refs: refs.subtracting([old]).union([new])) : self
    }
}

/// Everything the workspace shows for one worktree, read in one background pass.
struct WorktreeSnapshot: Sendable {
    let references: [Reference]
    let filter: HistoryFilter
    let history: HistoryState
    let files: [ChangedFile]
    let tracking: Tracking?
    let operation: RepositoryOperation?

    static func load(_ git: Git, filter requested: HistoryFilter) throws -> WorktreeSnapshot {
        let references = try git.references()
        let filter = requested.pruned(to: references)
        let page = try git.history(filter.scope, limit: Git.historyPageSize)
        let hidden = try git.headHidden(by: filter.scope)
        return WorktreeSnapshot(references: references, filter: filter,
                                history: .first(page, headHidden: hidden, pageSize: Git.historyPageSize),
                                files: try git.workingFiles(), tracking: try git.tracking(),
                                operation: try git.operationInProgress())
    }
}

/// The selected commit with its files and the diff of the first file.
struct CommitSelection: Sendable {
    let detail: CommitDetail
    let files: [ChangedFile]
    let file: ChangedFile?
    let patch: String
}
