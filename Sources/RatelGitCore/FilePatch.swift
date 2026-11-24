import Foundation

public struct DiffHunk: Hashable, Sendable {
    /// Index of the `@@` line within `FilePatch.lines`.
    public let headerIndex: Int
    public let oldStart: Int
    public let newStart: Int
    /// Indices of the hunk body lines within `FilePatch.lines`.
    public let body: Range<Int>
}

/// A single-file unified diff split into hunks, able to rebuild a patch for a subset of changed lines.
/// Line indices match `PatchDocument` because both split the text the same way.
public struct FilePatch: Sendable {
    public let lines: [String]
    public let hunks: [DiffHunk]
    private let headerEnd: Int
    private static let hunkPattern = #/^@@ -([0-9]+)(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@/#

    public init(_ text: String) {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
            .dropLast(text.hasSuffix("\n") ? 1 : 0).map(String.init)
        let starts = lines.indices.filter { lines[$0].hasPrefix("@@ ") }
        self.lines = lines
        headerEnd = starts.first ?? lines.count
        hunks = starts.enumerated().compactMap { position, start in
            guard let match = lines[start].prefixMatch(of: Self.hunkPattern),
                  let old = Int(match.1), let new = Int(match.2) else { return nil }
            let end = position + 1 < starts.count ? starts[position + 1] : lines.count
            return DiffHunk(headerIndex: start, oldStart: old, newStart: new, body: (start + 1)..<end)
        }
    }

    /// Patches that create or delete a file can only be applied whole.
    public var createsOrDeletesFile: Bool {
        lines[..<headerEnd].contains { $0.hasPrefix("new file mode") || $0.hasPrefix("deleted file mode") }
    }

    public var changedLines: Set<Int> { Set(hunks.flatMap { changedLines(in: $0) }) }

    public func changedLines(in hunk: DiffHunk) -> [Int] {
        hunk.body.filter { isChange(lines[$0]) }
    }

    public func hunk(containing index: Int) -> DiffHunk? {
        hunks.first { $0.body.contains(index) || $0.headerIndex == index }
    }

    /// Builds a patch that applies only `selection`. For `reverse` (unstage or discard) unselected additions
    /// stay as context and unselected removals are dropped; forward application does the opposite.
    public func patch(selecting selection: Set<Int>, reverse: Bool) throws -> String {
        let chosen = selection.intersection(changedLines)
        guard !chosen.isEmpty else { throw GitError(message: "Select changed lines first.") }
        if createsOrDeletesFile, chosen != changedLines {
            throw GitError(message: "A new or deleted file can only be changed as a whole.")
        }
        var shift = 0
        let parts = hunks.compactMap { hunk -> String? in
            guard changedLines(in: hunk).contains(where: chosen.contains) else { return nil }
            let body = rebuild(hunk, chosen: chosen, reverse: reverse)
            let oldCount = body.filter { $0.hasPrefix(" ") || $0.hasPrefix("-") }.count
            let newCount = body.filter { $0.hasPrefix(" ") || $0.hasPrefix("+") }.count
            let oldStart = reverse ? hunk.newStart - shift : hunk.oldStart
            let newStart = reverse ? hunk.newStart : hunk.oldStart + shift
            shift += newCount - oldCount
            return (["@@ -\(oldStart),\(oldCount) +\(newStart),\(newCount) @@"] + body).joined(separator: "\n")
        }
        return (lines[..<headerEnd] + parts).joined(separator: "\n") + "\n"
    }

    private func rebuild(_ hunk: DiffHunk, chosen: Set<Int>, reverse: Bool) -> [String] {
        var kept = false
        return hunk.body.compactMap { index -> String? in
            let line = lines[index]
            let rest = String(line.dropFirst())
            let output: String?
            switch line.first {
            case "+": output = chosen.contains(index) ? line : (reverse ? " " + rest : nil)
            case "-": output = chosen.contains(index) ? line : (reverse ? nil : " " + rest)
            case "\\": output = kept ? line : nil
            default: output = line
            }
            if line.first != "\\" { kept = output != nil }
            return output
        }
    }

    private func isChange(_ line: String) -> Bool {
        line.hasPrefix("+") || line.hasPrefix("-")
    }
}
