import Foundation

public enum LineOperation: String, Sendable {
    case stage = "Stage"
    case unstage = "Unstage"
    case discard = "Discard"
}

public enum GitAction: Sendable {
    case stage(ChangedFile)
    case unstage(ChangedFile)
    case discard(ChangedFile)
    /// Applies the selected lines of `source`, the diff the user was looking at.
    case applyLines(ChangedFile, source: String, lines: Set<Int>, LineOperation)
    case commit(String)
    case createBranch(String)
    case switchBranch(Reference)
    case checkoutRemote(Reference)
    case renameBranch(Reference, to: String)
    case deleteBranch(Reference, force: Bool)
    case merge(Reference)
    case rebase(onto: Reference)
    case abort(RepositoryOperation)
    case addWorktree(Reference, path: String)
    case stash(String)
    case applyStash(Reference)
    case dropStash(Reference)
    case fetch
    case pull
    case push

    public var label: String {
        switch self {
        case .stage: return "Stage"
        case .unstage: return "Unstage"
        case .discard: return "Discard"
        case .applyLines(_, _, _, let operation): return operation.rawValue
        case .commit: return "Commit"
        case .createBranch: return "Create Branch"
        case .switchBranch, .checkoutRemote: return "Check Out"
        case .renameBranch: return "Rename Branch"
        case .deleteBranch: return "Delete Branch"
        case .merge: return "Merge"
        case .rebase: return "Rebase"
        case .abort(let operation): return "Abort \(operation.rawValue)"
        case .addWorktree: return "Add Worktree"
        case .stash: return "Stash"
        case .applyStash: return "Apply Stash"
        case .dropStash: return "Drop Stash"
        case .fetch: return "Fetch"
        case .pull: return "Pull"
        case .push: return "Push"
        }
    }
}

public extension Git {
    func execute(_ action: GitAction) throws {
        switch action {
        case .stage, .unstage, .discard, .applyLines:
            try executeChange(action)
        case .createBranch, .switchBranch, .checkoutRemote, .renameBranch, .deleteBranch, .addWorktree:
            try executeBranch(action)
        case .merge, .rebase, .abort:
            try executeIntegration(action)
        case .commit(let text):
            let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !message.isEmpty else { throw GitError(message: "Enter a commit message.") }
            _ = try run(["commit", "-m", message], writing: true)
        case .stash(let message):
            let args = message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? [] : ["-m", message]
            _ = try run(["stash", "push", "--include-untracked"] + args, writing: true)
        case .applyStash(let ref):
            _ = try run(["stash", "apply", try stashRevision(ref)], writing: true)
        case .dropStash(let ref):
            try dropStash(ref)
        case .fetch:
            _ = try run(["fetch", "--all", "--no-recurse-submodules"], writing: true)
        case .pull, .push:
            try sync(action)
        }
    }

    private func stashRevision(_ ref: Reference) throws -> String {
        guard ref.kind == .stash, let revision = ref.revision else { throw GitError(message: "Select a stash.") }
        try validateHash(revision)
        return revision
    }

    /// `stash drop` only takes an index, so confirm the index still names the same stash commit.
    private func dropStash(_ ref: Reference) throws {
        let revision = try stashRevision(ref)
        guard ref.id.wholeMatch(of: #/stash@\{[0-9]+\}/#) != nil, try resolveCommit(ref.id) == revision else {
            throw GitError(message: "The stash list changed. Refresh and try again.")
        }
        _ = try run(["stash", "drop", "--quiet", ref.id], writing: true)
    }

    private func sync(_ action: GitAction) throws {
        guard let upstream = try tracking(), upstream.remote != "." else {
            throw GitError(message: "Configure a remote upstream for this branch before syncing.")
        }
        switch action {
        case .pull:
            _ = try run(["pull", "--ff-only", "--no-rebase", "--no-autostash", "--no-recurse-submodules", "--",
                         upstream.remote, upstream.target], writing: true)
        case .push:
            _ = try run(["push", "--no-follow-tags", "--no-recurse-submodules", "--", upstream.remote,
                         "refs/heads/\(upstream.branch):\(upstream.target)"], writing: true)
        default: break
        }
    }

    private func executeIntegration(_ action: GitAction) throws {
        switch action {
        case .merge(let ref):
            let name = try localBranchName(ref)
            _ = try run(["merge", "--no-edit", "--end-of-options", name], writing: true)
        case .rebase(let ref):
            let name = try localBranchName(ref)
            _ = try run(["rebase", "--no-autostash", "--end-of-options", name], writing: true)
        case .abort(let operation):
            guard try operationInProgress() == operation else {
                throw GitError(message: "No \(operation.rawValue.lowercased()) is in progress in this worktree.")
            }
            _ = try run([operation == .merge ? "merge" : "rebase", "--abort"], writing: true)
        default: break
        }
    }

    internal func localBranchName(_ ref: Reference) throws -> String {
        guard ref.kind == .local, ref.id == "refs/heads/" + ref.name, !ref.name.hasPrefix("-") else {
            throw GitError(message: "Select a local branch.")
        }
        return ref.name
    }

    internal func validate(_ file: ChangedFile, kinds: Set<ChangeKind>) throws {
        guard kinds.contains(file.kind), try workingFiles().contains(file) else {
            throw GitError(message: "The file status changed. Refresh and try again.")
        }
    }
}
