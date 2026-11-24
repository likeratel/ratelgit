import Foundation
import RatelGitCore

struct PatchLine: Equatable {
    enum Kind { case context, added, removed, header }
    /// Position in the diff text; the same index `FilePatch` uses for line staging.
    let index: Int
    let text: String
    let old: Int?
    let new: Int?
    let kind: Kind
    /// Character ranges that differ from the paired removed or added line.
    let emphasis: [Range<Int>]

    var isChange: Bool { kind == .added || kind == .removed }
    var isHunkHeader: Bool { kind == .header && text.hasPrefix("@@ ") }
}

struct PatchRow: Identifiable {
    let id: Int
    let left: PatchLine?
    let right: PatchLine?
}

struct PatchDocument {
    let lines: [PatchLine]
    /// Lines worth showing: the `diff --git`, `index`, `---` and `+++` lines are dropped when hunks follow.
    let displayLines: [PatchLine]
    private static let hunk = #/^@@ -([0-9]+)(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@/#
    private static let fileHeaderPrefixes = ["diff --git ", "index ", "--- ", "+++ "]

    init(_ patch: String) {
        let parsed = Self.parse(patch)
        let emphasis = Self.emphasis(parsed)
        let lines = parsed.map { line in
            PatchLine(index: line.index, text: line.text, old: line.old, new: line.new, kind: line.kind,
                      emphasis: emphasis[line.index] ?? [])
        }
        let firstHunk = lines.firstIndex(where: \.isHunkHeader) ?? lines.count
        self.lines = lines
        displayLines = lines.filter { line in
            line.index >= firstHunk || !Self.fileHeaderPrefixes.contains { line.text.hasPrefix($0) }
        }
    }

    var splitRows: [PatchRow] {
        var result: [PatchRow] = []
        var left: [PatchLine] = []
        var right: [PatchLine] = []
        func appendChanges() {
            for index in 0..<max(left.count, right.count) {
                result.append(PatchRow(id: result.count, left: left.indices.contains(index) ? left[index] : nil,
                                       right: right.indices.contains(index) ? right[index] : nil))
            }
            left.removeAll(keepingCapacity: true)
            right.removeAll(keepingCapacity: true)
        }
        for line in displayLines {
            switch line.kind {
            case .removed: left.append(line)
            case .added: right.append(line)
            case .header, .context:
                appendChanges()
                result.append(PatchRow(id: result.count, left: line, right: line.kind == .context ? line : nil))
            }
        }
        appendChanges()
        return result
    }

    private static func parse(_ patch: String) -> [PatchLine] {
        var old: Int?
        var new: Int?
        let raw = patch.split(separator: "\n", omittingEmptySubsequences: false).dropLast(patch.hasSuffix("\n") ? 1 : 0)
        return raw.enumerated().map { index, line in
            if let match = line.prefixMatch(of: Self.hunk) {
                old = Int(match.1)
                new = Int(match.2)
            } else if let previous = old, let current = new {
                let text = String(line.dropFirst())
                switch line.first {
                case " ":
                    old = previous + 1
                    new = current + 1
                    return PatchLine(index: index, text: text, old: previous, new: current, kind: .context, emphasis: [])
                case "+":
                    new = current + 1
                    return PatchLine(index: index, text: text, old: nil, new: current, kind: .added, emphasis: [])
                case "-":
                    old = previous + 1
                    return PatchLine(index: index, text: text, old: previous, new: nil, kind: .removed, emphasis: [])
                default: break
                }
            }
            return PatchLine(index: index, text: String(line), old: nil, new: nil, kind: .header, emphasis: [])
        }
    }

    /// Pairs the n-th removed line of a change block with its n-th added line, like the split layout does.
    private static func emphasis(_ lines: [PatchLine]) -> [Int: [Range<Int>]] {
        var result: [Int: [Range<Int>]] = [:]
        var removed: [PatchLine] = []
        var added: [PatchLine] = []
        func flush() {
            for (left, right) in zip(removed, added) {
                guard let changes = WordDiff.changes(old: left.text, new: right.text) else { continue }
                result[left.index] = changes.removed
                result[right.index] = changes.added
            }
            removed = []
            added = []
        }
        for line in lines {
            switch line.kind {
            case .removed:
                if !added.isEmpty { flush() }
                removed.append(line)
            case .added: added.append(line)
            default: flush()
            }
        }
        flush()
        return result
    }
}
