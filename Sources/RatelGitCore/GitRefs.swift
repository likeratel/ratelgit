import Foundation

public extension Git {
    func worktrees() throws -> [Worktree] {
        let records = try run(["worktree", "list", "--porcelain", "-z"])
        let upstreams = try upstreamCounts()
        return records.components(separatedBy: "\0\0").compactMap { record in
            let fields = record.components(separatedBy: "\0")
            guard let entry = fields.first, entry.hasPrefix("worktree ") else { return nil }
            let location = String(entry.dropFirst(9))
            let branch = fields.first { $0.hasPrefix("branch refs/heads/") }
                .map { String($0.dropFirst(18)) }
            let unavailable = fields.contains { $0.hasPrefix("prunable") || $0 == "bare" }
                || !FileManager.default.fileExists(atPath: location)
            let changes = unavailable ? nil : try? Set(Git(path: location).workingFiles().map(\.path)).count
            let counts = branch.flatMap { upstreams[$0] }
            return Worktree(path: location, branch: branch ?? "Detached HEAD", unavailable: unavailable,
                            changes: changes, ahead: counts?.ahead, behind: counts?.behind)
        }
    }

    /// The first worktree Git lists is the main one; it identifies the repository.
    func mainWorktreePath() throws -> String {
        guard let main = try worktrees().first?.path else {
            throw GitError(message: "This folder has no Git worktree.")
        }
        return main
    }

    func references() throws -> [Reference] {
        let format = ["%(refname)", "%(HEAD)", "%(worktreepath)", "%(symref)", "%(objectname)", "%(*objectname)"]
            .joined(separator: "%00")
        let refs = try run(["for-each-ref", "--format=\(format)", "refs/heads", "refs/remotes", "refs/tags"])
        let branches = refs.split(separator: "\n").compactMap(Self.parseReference)
        let stash = try run(["stash", "list", "--format=%gd%x1f%H%x1f%gs"])
        return branches + stash.split(separator: "\n").compactMap { line in
            let fields = line.split(separator: "\u{1f}", maxSplits: 2)
            guard fields.count == 3 else { return nil }
            return Reference(id: String(fields[0]), name: "\(fields[0])  \(fields[2])", kind: .stash,
                             revision: String(fields[1]), target: String(fields[1]))
        }
    }

    private static let refPrefixes: [(String, ReferenceKind)] = [
        ("refs/heads/", .local), ("refs/remotes/", .remote), ("refs/tags/", .tag)
    ]

    private static func parseReference(_ line: Substring) -> Reference? {
        let fields = line.components(separatedBy: "\0")
        guard fields.count == 6, fields[3].isEmpty,
              let (prefix, kind) = refPrefixes.first(where: { fields[0].hasPrefix($0.0) }) else { return nil }
        let target = fields[5].isEmpty ? fields[4] : fields[5]
        return Reference(id: fields[0], name: String(fields[0].dropFirst(prefix.count)), kind: kind,
                         target: target.isEmpty ? nil : target, isHead: fields[1] == "*",
                         worktreePath: fields[2].isEmpty ? nil : fields[2])
    }

    func remotes() throws -> [String] {
        try run(["remote"]).split(separator: "\n").map(String.init)
    }

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

    /// Merge or rebase that stopped in this worktree and waits for the user.
    func operationInProgress() throws -> RepositoryOperation? {
        let paths = try run(["rev-parse", "--git-path", "MERGE_HEAD", "--git-path", "rebase-merge",
                             "--git-path", "rebase-apply"])
            .split(separator: "\n").map { location -> String in
                let text = String(location)
                return text.hasPrefix("/") ? text : URL(fileURLWithPath: path).appendingPathComponent(text).path
            }
        guard paths.count == 3 else { return nil }
        let exists = paths.map { FileManager.default.fileExists(atPath: $0) }
        if exists[1] || exists[2] { return .rebase }
        return exists[0] ? .merge : nil
    }

    /// Ahead and behind counts for every local branch with an upstream, from a single `for-each-ref`.
    private func upstreamCounts() throws -> [String: (ahead: Int, behind: Int)] {
        let output = try run(["for-each-ref", "--format=%(refname:lstrip=2)%00%(upstream)%00%(upstream:track,nobracket)",
                              "refs/heads"])
        return output.split(separator: "\n").reduce(into: [:]) { result, line in
            let fields = line.components(separatedBy: "\0")
            guard fields.count == 3, !fields[1].isEmpty, fields[2] != "gone" else { return }
            result[fields[0]] = Self.parseTrack(fields[2])
        }
    }

    internal static func parseTrack(_ text: String) -> (ahead: Int, behind: Int) {
        text.components(separatedBy: ", ").reduce(into: (ahead: 0, behind: 0)) { counts, part in
            let words = part.split(separator: " ")
            guard words.count == 2, let value = Int(words[1]) else { return }
            if words[0] == "ahead" { counts.ahead = value }
            if words[0] == "behind" { counts.behind = value }
        }
    }
}
