import Foundation

extension Git {
    func executeBranch(_ action: GitAction) throws {
        switch action {
        case .createBranch(let name):
            try validateBranchName(name)
            _ = try run(["switch", "-c", name], writing: true)
        case .switchBranch(let ref):
            _ = try run(["switch", "--", try localBranchName(ref)], writing: true)
        case .checkoutRemote(let ref):
            let local = try trackingName(for: ref)
            _ = try run(["switch", "--track", "-c", local, "--end-of-options", ref.id], writing: true)
        case .renameBranch(let ref, let name):
            let current = try localBranchName(ref)
            try validateBranchName(name)
            _ = try run(["branch", "--move", "--", current, name], writing: true)
        case .deleteBranch(let ref, let force):
            let name = try localBranchName(ref)
            _ = try run(["branch", force ? "-D" : "-d", "--", name], writing: true)
        case .addWorktree(let ref, let location):
            let name = try localBranchName(ref)
            _ = try run(["worktree", "add", "--", try validateWorktreePath(location), name], writing: true)
        default:
            break
        }
    }

    /// Local name for a remote branch: `origin/feature/x` becomes `feature/x`.
    public func trackingName(for ref: Reference) throws -> String {
        guard ref.kind == .remote, ref.id == "refs/remotes/" + ref.name else {
            throw GitError(message: "Select a remote branch.")
        }
        let remote = try remotes().filter { ref.name.hasPrefix($0 + "/") }.max { $0.count < $1.count }
        guard let remote else { throw GitError(message: "No remote matches \(ref.name).") }
        let local = String(ref.name.dropFirst(remote.count + 1))
        try validateBranchName(local)
        return local
    }

    func validateWorktreePath(_ location: String) throws -> String {
        let expanded = (location.trimmingCharacters(in: .whitespacesAndNewlines) as NSString).expandingTildeInPath
        guard expanded.hasPrefix("/"), !expanded.contains(where: \.isNewline) else {
            throw GitError(message: "Enter an absolute folder path for the new worktree.")
        }
        return URL(fileURLWithPath: expanded).standardizedFileURL.path
    }
}
