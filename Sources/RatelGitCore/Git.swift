import Foundation

public struct Worktree: Identifiable, Hashable, Sendable {
    public let path: String
    public let branch: String
    public let unavailable: Bool
    public let changes: Int?
    public var id: String { path }
    public var name: String { URL(fileURLWithPath: path).lastPathComponent }
}

public struct Reference: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let group: String
    public let revision: String?
}

public struct GraphLine: Identifiable, Hashable, Sendable {
    public let id: Int
    public let lanes: String
    public let hash: String?
    public let subject: String
    public let title: String
    public let shortHash: String
    public let author: String
    public let date: String
    public let labels: [String]
    public let parents: [String]
}

public enum ChangeKind: String, CaseIterable, Sendable {
    case staged = "Staged"
    case unstaged = "Unstaged"
    case untracked = "Untracked"
    case committed = "Commit"
}

public struct ChangedFile: Identifiable, Hashable, Sendable {
    public let path: String
    public let kind: ChangeKind
    public let status: String
    public var id: Self { self }
}

public struct GitError: LocalizedError, Sendable {
    public let message: String
    public var errorDescription: String? { message }
}

public struct Git: Sendable {
    public let path: String
    public init(path: String) { self.path = path }

    func run(_ args: [String], accepted: Set<Int32> = [0], writing: Bool = false, literalPaths: Bool = false) throws -> String {
        try Task.checkCancellation()
        let process = Process()
        let pipe = Pipe()
        let errorPipe = Pipe()
        let diagnostics = DiagnosticReader(pipe: errorPipe)
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = (writing ? [] : ["--no-optional-locks"]) + (literalPaths ? ["--literal-pathspecs"] : []) + ["--no-pager",
                             "-c", "color.ui=false", "-c", "core.fsmonitor=false", "-C", path] + args
        process.environment = ProcessInfo.processInfo.environment.filter {
            !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"].contains($0.key)
        }.merging(
            ["LC_ALL": "C", "GIT_TERMINAL_PROMPT": "0", "GIT_EDITOR": "false"], uniquingKeysWith: { _, value in value }
        )
        process.standardOutput = pipe
        process.standardError = errorPipe
        try process.run()
        diagnostics.start()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let stderr = diagnostics.message()
        let status = process.terminationStatus
        let noIndexFailure = args.contains("--no-index") && status != 0 && data.isEmpty && !stderr.isEmpty
        guard process.terminationReason == .exit, accepted.contains(status), !noIndexFailure else {
            throw GitError(message: stderr.isEmpty ? "Git failed with status \(status)." : stderr)
        }
        return String(decoding: data, as: UTF8.self)
    }

    public func worktreeRoot() throws -> String {
        let output = try run(["rev-parse", "--show-toplevel"])
        return output.hasSuffix("\n") ? String(output.dropLast()) : output
    }

    public func worktrees() throws -> [Worktree] {
        let records = try run(["worktree", "list", "--porcelain", "-z"])
        return records.components(separatedBy: "\0\0").compactMap { record in
            let fields = record.components(separatedBy: "\0")
            guard let entry = fields.first, entry.hasPrefix("worktree ") else { return nil }
            let location = String(entry.dropFirst(9))
            let branch = fields.first { $0.hasPrefix("branch refs/heads/") }
                .map { String($0.dropFirst(18)) }
            let unavailable = fields.contains { $0.hasPrefix("prunable") || $0 == "bare" }
                || !FileManager.default.fileExists(atPath: location)
            let changes = unavailable ? nil : try? Set(Git(path: location).workingFiles().map(\.path)).count
            return Worktree(path: location, branch: branch ?? "Detached HEAD",
                            unavailable: unavailable, changes: changes)
        }
    }

    public func references() throws -> [Reference] {
        let refs = try run(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"])
        let groups = [("refs/heads/", "Local branches"), ("refs/remotes/", "Remote branches"), ("refs/tags/", "Tags")]
        let branches = refs.split(separator: "\n").compactMap { ref -> Reference? in
            guard let (prefix, group) = groups.first(where: { ref.hasPrefix($0.0) }) else { return nil }
            return Reference(id: String(ref), name: String(ref.dropFirst(prefix.count)), group: group, revision: nil)
        }
        let stash = try run(["stash", "list", "--format=%gd%x1f%H%x1f%gs"])
        return branches + stash.split(separator: "\n").compactMap { line in
            let fields = line.split(separator: "\u{1f}", maxSplits: 2)
            guard fields.count == 3 else { return nil }
            return Reference(id: String(fields[0]), name: "\(fields[0])  \(fields[2])", group: "Stashes", revision: String(fields[1]))
        }
    }

    public func graph(ref: String? = nil) throws -> [GraphLine] {
        let revision = ref ?? "HEAD"
        let resolved = try run(["rev-parse", "--verify", "--quiet", "--end-of-options", revision + "^{commit}"], accepted: [0, 1])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !resolved.isEmpty else { return [] }
        let log = try run(["log", "--graph", "--topo-order", "-n", "400",
                           "--format=%x1f%H%x1f%h%x1f%D%x1f%P%x1f%aN%x1f%as%x1f%s", resolved, "--"])
        return log.split(separator: "\n", omittingEmptySubsequences: true).enumerated().map { index, line in
            let fields = line.split(separator: "\u{1f}", maxSplits: 7, omittingEmptySubsequences: false)
            guard fields.count == 8 else {
                return GraphLine(id: index, lanes: String(line), hash: nil, subject: "",
                                 title: "", shortHash: "", author: "", date: "", labels: [], parents: [])
            }
            return GraphLine(id: index, lanes: String(fields[0]), hash: String(fields[1]),
                             subject: "\(fields[2])  \(fields[7])", title: String(fields[7]),
                             shortHash: String(fields[2]), author: String(fields[5]), date: String(fields[6]),
                             labels: fields[3].components(separatedBy: ", ").filter { !$0.isEmpty },
                             parents: fields[4].split(separator: " ").map(String.init))
        }
    }

    public func workingFiles() throws -> [ChangedFile] {
        let records = try run(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"])
        return records.split(separator: "\0").flatMap { record -> [ChangedFile] in
            guard record.count >= 4 else { return [] }
            let x = record[record.startIndex]
            let y = record[record.index(after: record.startIndex)]
            let name = String(record.dropFirst(3))
            if x == "?" { return [ChangedFile(path: name, kind: .untracked, status: "?")] }
            if ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].contains(String([x, y])) {
                return [ChangedFile(path: name, kind: .unstaged, status: "U")]
            }
            return [(x, ChangeKind.staged), (y, .unstaged)].compactMap { code, kind in
                code == " " ? nil : ChangedFile(path: name, kind: kind, status: String(code))
            }
        }
    }

    public func commitFiles(_ hash: String) throws -> [ChangedFile] {
        try validateHash(hash)
        let output = try run(["show", "--format=", "--diff-merges=first-parent", "--no-ext-diff", "--no-textconv",
                              "--no-renames", "--name-status", "-z", hash, "--"])
        let records = output.split(separator: "\0")
        return stride(from: 0, to: records.count - (records.count % 2), by: 2).map { index in
            ChangedFile(path: String(records[index + 1]), kind: .committed, status: String(records[index]))
        }
    }

    public func diff(_ file: ChangedFile, commit: String? = nil) throws -> String {
        let options = ["--no-ext-diff", "--no-textconv", "--no-renames"]
        switch file.kind {
        case .staged: return try run(["diff", "--cached"] + options + ["--", file.path], literalPaths: true)
        case .unstaged: return try run(["diff"] + options + ["--", file.path], literalPaths: true)
        case .untracked:
            if file.path.hasSuffix("/") { return "Untracked nested repository: \(file.path)" }
            return try run(["diff", "--no-index"] + options + ["--", "/dev/null", "./" + file.path], accepted: [0, 1])
        case .committed:
            guard let commit else { throw GitError(message: "Select a commit to view its diff.") }
            try validateHash(commit)
            return try run(["show", "--format=", "--diff-merges=first-parent"] + options + [commit, "--", file.path], literalPaths: true)
        }
    }

    func validateHash(_ hash: String) throws {
        guard [40, 64].contains(hash.utf8.count), hash.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw GitError(message: "Invalid commit ID.")
        }
    }
}

private final class DiagnosticReader: @unchecked Sendable {
    private let pipe: Pipe
    private let queue = DispatchQueue(label: "ratelgit.git.stderr")
    private var data = Data()

    init(pipe: Pipe) { self.pipe = pipe }

    func start() {
        queue.async { self.data = self.pipe.fileHandleForReading.readDataToEndOfFile() }
    }

    func message() -> String {
        queue.sync { String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) }
    }
}
