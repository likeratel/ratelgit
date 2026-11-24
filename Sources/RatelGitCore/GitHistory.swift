import Foundation

/// Which refs the history graph walks from.
public enum HistoryScope: Hashable, Sendable {
    /// Every local branch, remote branch and tag, plus HEAD.
    case all
    /// Only commits reachable from these full ref names (or `HEAD`).
    case refs([String])
}

public extension Git {
    static let historyPageSize = 500
    private static let logFormat = "--format=%H%x1f%h%x1f%D%x1f%P%x1f%aN%x1f%as%x1f%s"

    /// Single-ref history, kept for browsing one ref or a stash.
    func graph(ref: String? = nil) throws -> [GraphLine] {
        guard let resolved = try resolveCommit(ref ?? "HEAD") else { return [] }
        return try page(arguments: ["--end-of-options", resolved], skip: 0, limit: 400)
    }

    /// One page of the topologically ordered history. Pages share one ordering, so `skip` continues a listing.
    func history(_ scope: HistoryScope, skip: Int = 0, limit: Int = historyPageSize) throws -> [GraphLine] {
        switch scope {
        case .all:
            let head = try resolveCommit("HEAD") == nil ? [] : ["HEAD"]
            return try page(arguments: ["--branches", "--remotes", "--tags", "--end-of-options"] + head,
                            skip: skip, limit: limit)
        case .refs(let refs):
            try refs.forEach(validateRefName)
            guard !refs.isEmpty else { return [] }
            let existing = try refs.filter { try resolveCommit($0) != nil }
            guard !existing.isEmpty else { return [] }
            return try page(arguments: ["--end-of-options"] + existing, skip: skip, limit: limit)
        }
    }

    /// True when the current HEAD commit is not reachable from any of the given refs.
    func headHidden(by scope: HistoryScope) throws -> Bool {
        guard case .refs(let refs) = scope, !refs.contains("HEAD") else { return false }
        try refs.forEach(validateRefName)
        guard try resolveCommit("HEAD") != nil else { return false }
        let existing = try refs.filter { try resolveCommit($0) != nil }
        let outside = try run(["rev-list", "-n", "1", "HEAD", "--not"] + existing + ["--"])
        return !outside.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func commitDetail(_ hash: String) throws -> CommitDetail {
        try validateHash(hash)
        let output = try run(["show", "-s", "--format=%H%x00%P%x00%aN%x00%aE%x00%aI%x00%B", hash, "--"])
        let fields = output.components(separatedBy: "\0")
        guard fields.count == 6 else { throw GitError(message: "Could not read commit \(hash.prefix(8)).") }
        return CommitDetail(hash: fields[0], parents: fields[1].split(separator: " ").map(String.init),
                            author: fields[2], email: fields[3], date: fields[4],
                            message: fields[5].trimmingCharacters(in: .whitespacesAndNewlines))
    }

    internal func resolveCommit(_ revision: String) throws -> String? {
        let resolved = try run(["rev-parse", "--verify", "--quiet", "--end-of-options", revision + "^{commit}"],
                               accepted: [0, 1]).trimmingCharacters(in: .whitespacesAndNewlines)
        return resolved.isEmpty ? nil : resolved
    }

    private func validateRefName(_ ref: String) throws {
        guard ref == "HEAD" || (ref.hasPrefix("refs/") && !ref.contains(where: { $0.isWhitespace || $0.isNewline })) else {
            throw GitError(message: "Invalid history filter “\(ref)”.")
        }
    }

    private func page(arguments: [String], skip: Int, limit: Int) throws -> [GraphLine] {
        let log = try run(["log", "--topo-order", "--skip=\(max(skip, 0))", "-n", String(max(limit, 1)), Self.logFormat]
                          + arguments + ["--"])
        return log.split(separator: "\n", omittingEmptySubsequences: true).enumerated().compactMap { index, line in
            Self.parseLine(line, id: skip + index)
        }
    }

    private static func parseLine(_ line: Substring, id: Int) -> GraphLine? {
        let fields = line.split(separator: "\u{1f}", maxSplits: 6, omittingEmptySubsequences: false)
        guard fields.count == 7 else { return nil }
        return GraphLine(id: id, hash: String(fields[0]), subject: "\(fields[1])  \(fields[6])", title: String(fields[6]),
                         shortHash: String(fields[1]), author: String(fields[4]), date: String(fields[5]),
                         labels: fields[2].components(separatedBy: ", ").filter { !$0.isEmpty },
                         parents: fields[3].split(separator: " ").map(String.init))
    }
}
