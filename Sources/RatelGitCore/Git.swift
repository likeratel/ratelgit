import Foundation

public struct Git: Sendable {
    public let path: String
    public init(path: String) { self.path = path }

    static let diffOptions = ["--no-ext-diff", "--no-textconv", "--no-renames", "--no-relative",
                              "--src-prefix=a/", "--dst-prefix=b/"]
    private static let maximumFallbackMessage = 600
    private static let scrubbedEnvironment = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"]
    // Writing a patch to a git process that already exited must fail with EPIPE instead of killing the app.
    private static let ignoreBrokenPipe: Void = { signal(SIGPIPE, SIG_IGN) }()

    func run(_ args: [String], accepted: Set<Int32> = [0], writing: Bool = false, literalPaths: Bool = false,
             input: Data? = nil) throws -> String {
        try Task.checkCancellation()
        let process = Process()
        let pipe = Pipe()
        let errorPipe = Pipe()
        let diagnostics = DiagnosticReader(pipe: errorPipe)
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = (writing ? [] : ["--no-optional-locks"]) + (literalPaths ? ["--literal-pathspecs"] : []) + ["--no-pager",
                             "-c", "color.ui=false", "-c", "core.fsmonitor=false", "-C", path] + args
        process.environment = ProcessInfo.processInfo.environment.filter {
            !Self.scrubbedEnvironment.contains($0.key)
        }.merging(
            ["LC_ALL": "C", "GIT_TERMINAL_PROMPT": "0", "GIT_EDITOR": "false"], uniquingKeysWith: { _, value in value }
        )
        process.standardOutput = pipe
        process.standardError = errorPipe
        let inputPipe = input.map { _ in Pipe() }
        process.standardInput = inputPipe ?? FileHandle.nullDevice
        Self.ignoreBrokenPipe
        try process.run()
        diagnostics.start()
        if let input, let inputPipe { feed(input, to: inputPipe.fileHandleForWriting) }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let stderr = diagnostics.message()
        let status = process.terminationStatus
        let output = String(decoding: data, as: UTF8.self)
        let noIndexFailure = args.contains("--no-index") && status != 0 && data.isEmpty && !stderr.isEmpty
        guard process.terminationReason == .exit, accepted.contains(status), !noIndexFailure else {
            throw GitError(message: Self.failureMessage(stderr: stderr, stdout: output, status: status))
        }
        return output
    }

    private func feed(_ input: Data, to handle: FileHandle) {
        DispatchQueue.global(qos: .userInitiated).async {
            try? handle.write(contentsOf: input)
            try? handle.close()
        }
    }

    /// Merge reports conflicts on stdout, so fall back to it when stderr is empty.
    private static func failureMessage(stderr: String, stdout: String, status: Int32) -> String {
        if !stderr.isEmpty { return stderr }
        let trimmed = stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return String(trimmed.suffix(maximumFallbackMessage)) }
        return "Git failed with status \(status)."
    }

    public func worktreeRoot() throws -> String {
        let output = try run(["rev-parse", "--show-toplevel"])
        return output.hasSuffix("\n") ? String(output.dropLast()) : output
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

    public func diff(_ file: ChangedFile, commit: String? = nil, ignoreWhitespace: Bool = false) throws -> String {
        let options = Self.diffOptions + (ignoreWhitespace ? ["--ignore-all-space"] : [])
        switch file.kind {
        case .staged: return try run(["diff", "--cached"] + options + ["--", file.path], literalPaths: true)
        case .unstaged: return try run(["diff"] + options + ["--", file.path], literalPaths: true)
        case .untracked:
            if file.path.hasSuffix("/") { return "Untracked nested repository: \(file.path)" }
            return try run(["diff", "--no-index"] + options + ["--", "/dev/null", "./" + file.path], accepted: [0, 1])
        case .committed:
            guard let commit else { throw GitError(message: "Select a commit to view its diff.") }
            try validateHash(commit)
            return try run(["show", "--format=", "--diff-merges=first-parent"] + options + [commit, "--", file.path],
                           literalPaths: true)
        }
    }

    func validateHash(_ hash: String) throws {
        guard [40, 64].contains(hash.utf8.count), hash.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw GitError(message: "Invalid commit ID.")
        }
    }

    /// Rejects names Git would read as options or that `check-ref-format` refuses.
    func validateBranchName(_ name: String) throws {
        guard !name.isEmpty, !name.hasPrefix("-"), !name.contains(where: \.isNewline) else {
            throw GitError(message: "Enter a valid branch name.")
        }
        do {
            _ = try run(["check-ref-format", "refs/heads/" + name])
        } catch {
            throw GitError(message: "“\(name)” is not a valid branch name.")
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
