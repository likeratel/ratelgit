import Foundation

/// Changed character ranges between a removed line and the added line paired with it.
public struct WordChanges: Equatable, Sendable {
    public let removed: [Range<Int>]
    public let added: [Range<Int>]
}

public enum WordDiff {
    /// Above this many token pairs the middle part is treated as one change instead of running LCS.
    private static let maximumComparisons = 60_000
    /// Lines that share less than this fraction of characters are shown without word emphasis.
    private static let minimumShared = 0.35

    public static func changes(old: String, new: String) -> WordChanges? {
        let left = tokens(old)
        let right = tokens(new)
        let prefix = zip(left, right).prefix { $0 == $1 }.count
        let suffix = zip(left[prefix...].reversed(), right[prefix...].reversed()).prefix { $0 == $1 }.count
        let leftMiddle = Array(left[prefix..<(left.count - suffix)])
        let rightMiddle = Array(right[prefix..<(right.count - suffix)])
        let (leftKept, rightKept) = commonTokens(leftMiddle, rightMiddle)
        let removed = ranges(left, changed: Set(leftMiddle.indices.filter { !leftKept.contains($0) }.map { $0 + prefix }))
        let added = ranges(right, changed: Set(rightMiddle.indices.filter { !rightKept.contains($0) }.map { $0 + prefix }))
        let shared = 1 - Double(removed.map(\.count).reduce(0, +) + added.map(\.count).reduce(0, +))
            / Double(max(old.count + new.count, 1))
        guard shared >= minimumShared else { return nil }
        return WordChanges(removed: removed, added: added)
    }

    /// Words, runs of whitespace, and single punctuation characters.
    static func tokens(_ text: String) -> [String] {
        var result: [String] = []
        var current = ""
        var currentClass = -1
        for character in text {
            let kind = character.isLetter || character.isNumber || character == "_" ? 0 : character.isWhitespace ? 1 : 2
            if kind != currentClass || kind == 2, !current.isEmpty {
                result.append(current)
                current = ""
            }
            current.append(character)
            currentClass = kind
        }
        if !current.isEmpty { result.append(current) }
        return result
    }

    /// Indices of tokens on each side that belong to a longest common subsequence.
    private static func commonTokens(_ left: [String], _ right: [String]) -> (Set<Int>, Set<Int>) {
        guard !left.isEmpty, !right.isEmpty, left.count * right.count <= maximumComparisons else { return ([], []) }
        var table = Array(repeating: Array(repeating: 0, count: right.count + 1), count: left.count + 1)
        for i in stride(from: left.count - 1, through: 0, by: -1) {
            for j in stride(from: right.count - 1, through: 0, by: -1) {
                table[i][j] = left[i] == right[j] ? table[i + 1][j + 1] + 1 : max(table[i + 1][j], table[i][j + 1])
            }
        }
        var i = 0, j = 0
        var kept: (Set<Int>, Set<Int>) = ([], [])
        while i < left.count, j < right.count {
            if left[i] == right[j] {
                kept.0.insert(i)
                kept.1.insert(j)
                i += 1
                j += 1
            } else if table[i + 1][j] >= table[i][j + 1] {
                i += 1
            } else {
                j += 1
            }
        }
        return kept
    }

    /// Character ranges of changed tokens, with neighbouring ranges merged.
    private static func ranges(_ tokens: [String], changed: Set<Int>) -> [Range<Int>] {
        var offset = 0
        var result: [Range<Int>] = []
        for (index, token) in tokens.enumerated() {
            let range = offset..<(offset + token.count)
            offset = range.upperBound
            guard changed.contains(index) else { continue }
            if let last = result.last, last.upperBound == range.lowerBound {
                result[result.count - 1] = last.lowerBound..<range.upperBound
            } else {
                result.append(range)
            }
        }
        return result
    }
}
