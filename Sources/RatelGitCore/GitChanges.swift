import Foundation

extension Git {
    func executeChange(_ action: GitAction) throws {
        switch action {
        case .stage(let file):
            try validate(file, kinds: [.unstaged, .untracked])
            if file.path.hasSuffix("/") { throw GitError(message: "Add this nested repository from Terminal.") }
            _ = try run(["add", "--", file.path], writing: true, literalPaths: true)
        case .unstage(let file):
            try validate(file, kinds: [.staged])
            if try run(["rev-parse", "--verify", "--quiet", "HEAD"], accepted: [0, 1]).isEmpty {
                _ = try run(["rm", "--cached", "--force", "--", file.path], writing: true, literalPaths: true)
            } else {
                _ = try run(["restore", "--staged", "--", file.path], writing: true, literalPaths: true)
            }
        case .discard(let file):
            try discard(file)
        case .applyLines(let file, let source, let lines, let operation):
            try apply(lines, of: source, in: file, operation: operation)
        default:
            break
        }
    }

    /// Restores a tracked file from the index, or deletes an untracked file. Neither can be undone.
    private func discard(_ file: ChangedFile) throws {
        guard !file.isConflicted else { throw GitError(message: "Resolve or abort the conflict instead of discarding.") }
        try validate(file, kinds: [.unstaged, .untracked])
        switch file.kind {
        case .unstaged:
            _ = try run(["restore", "--worktree", "--", file.path], writing: true, literalPaths: true)
        case .untracked:
            if file.path.hasSuffix("/") { throw GitError(message: "Remove this nested repository from Finder.") }
            _ = try run(["clean", "--force", "--quiet", "--", file.path], writing: true, literalPaths: true)
        default:
            break
        }
    }

    private func apply(_ lines: Set<Int>, of source: String, in file: ChangedFile, operation: LineOperation) throws {
        guard !file.isConflicted else { throw GitError(message: "Stage a conflicted file as a whole after resolving it.") }
        try validate(file, kinds: operation == .unstage ? [.staged] : [.unstaged])
        // The patch is built from what the user saw, so refuse if the file changed since then.
        guard try diff(file) == source else {
            throw GitError(message: "The file changed since its diff was shown. Refresh and try again.")
        }
        let patch = try FilePatch(source).patch(selecting: lines, reverse: operation != .stage)
        let target: [String]
        switch operation {
        case .stage: target = ["--cached"]
        case .unstage: target = ["--cached", "--reverse"]
        case .discard: target = ["--reverse"]
        }
        _ = try run(["apply"] + target + ["--recount", "--whitespace=nowarn", "-"], writing: true,
                    input: Data(patch.utf8))
    }
}
