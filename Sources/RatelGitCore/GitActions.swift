import Foundation

public struct Tracking: Sendable {
    public let branch: String
    public let remote: String
    public let target: String
    public let ahead: Int
    public let behind: Int
}

public enum GitAction: Sendable {
    case stage(ChangedFile)
    case unstage(ChangedFile)
    case commit(String)
    case createBranch(String)
    case switchBranch(Reference)
    case stash(String)
    case applyStash(Reference)
    case fetch
    case pull
    case push

    public var label: String {
        switch self {
        case .stage: return "Stage"
        case .unstage: return "Unstage"
        case .commit: return "Commit"
        case .createBranch: return "Create Branch"
        case .switchBranch: return "Switch Branch"
        case .stash: return "Stash"
        case .applyStash: return "Apply Stash"
        case .fetch: return "Fetch"
        case .pull: return "Pull"
        case .push: return "Push"
        }
    }
}

public extension Git {
    func tracking() throws -> Tracking? {
        let ref = try run(["symbolic-ref", "--quiet", "HEAD"], accepted: [0, 1])
            .trimmingCharacters(in: .newlines)
        guard ref.hasPrefix("refs/heads/") else { return nil }
        let branch = String(ref.dropFirst("refs/heads/".count))
        let format = "%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)"
        let fields = try run(["for-each-ref", "--format=\(format)", ref])
            .trimmingCharacters(in: .newlines).components(separatedBy: "\0")
        guard fields.count == 3, !fields[0].isEmpty, fields[1].hasPrefix("refs/heads/"),
              !fields[2].isEmpty else { return nil }
        let exists = try run(["rev-parse", "--verify", "--quiet", fields[2]], accepted: [0, 1])
        guard !exists.isEmpty else { return nil }
        let counts = try run(["rev-list", "--left-right", "--count", "HEAD...\(fields[2])", "--"])
            .split(whereSeparator: \.isWhitespace).compactMap { Int($0) }
        guard counts.count == 2 else { return nil }
        return Tracking(branch: branch, remote: fields[0], target: fields[1], ahead: counts[0], behind: counts[1])
    }

    func execute(_ action: GitAction) throws {
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
        case .commit(let text):
            let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !message.isEmpty else { throw GitError(message: "Enter a commit message.") }
            _ = try run(["commit", "-m", message], writing: true)
        case .createBranch(let name):
            guard !name.isEmpty, !name.hasPrefix("-") else { throw GitError(message: "Enter a valid branch name.") }
            _ = try run(["check-ref-format", "refs/heads/" + name])
            _ = try run(["switch", "-c", name], writing: true)
        case .switchBranch(let ref):
            guard ref.id == "refs/heads/" + ref.name, !ref.name.hasPrefix("-") else {
                throw GitError(message: "Select a local branch.")
            }
            _ = try run(["switch", "--", ref.name], writing: true)
        case .stash(let message):
            let args = message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? [] : ["-m", message]
            _ = try run(["stash", "push", "--include-untracked"] + args, writing: true)
        case .applyStash(let ref):
            guard ref.group == "Stashes", let revision = ref.revision else {
                throw GitError(message: "Select a stash.")
            }
            try validateHash(revision)
            _ = try run(["stash", "apply", revision], writing: true)
        case .fetch:
            _ = try run(["fetch", "--all", "--no-recurse-submodules"], writing: true)
        case .pull, .push:
            try sync(action)
        }
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

    private func validate(_ file: ChangedFile, kinds: Set<ChangeKind>) throws {
        guard kinds.contains(file.kind), try workingFiles().contains(file) else {
            throw GitError(message: "The file status changed. Refresh and try again.")
        }
    }
}
