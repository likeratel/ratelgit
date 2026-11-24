import Foundation

/// Subsequence matching for the quick switcher. Higher scores rank first; nil means no match.
public enum FuzzyMatch {
    private static let matchScore = 1
    private static let consecutiveBonus = 6
    private static let boundaryBonus = 8
    private static let prefixBonus = 25
    private static let substringBonus = 15
    private static let maximumGapPenalty = 4
    private static let separators: Set<Character> = ["/", "-", "_", " ", ".", "@"]

    public static func score(_ query: String, in candidate: String) -> Int? {
        let needle = Array(query.lowercased().filter { !$0.isWhitespace })
        guard !needle.isEmpty else { return 0 }
        let original = Array(candidate)
        let haystack = Array(candidate.lowercased())
        guard original.count == haystack.count else { return substringScore(query, in: candidate) }
        let best = haystack.indices.filter { haystack[$0] == needle[0] }
            .compactMap { walk(needle, haystack: haystack, original: original, from: $0) }
            .max()
        guard let best else { return nil }
        let prefix = haystack.starts(with: needle)
        return best + (prefix ? prefixBonus : 0) + (containsAtBoundary(needle, haystack: haystack, original: original) ? substringBonus : 0)
    }

    /// Ranks candidates by score, keeping the original order for ties.
    public static func rank<T>(_ items: [T], query: String, text: (T) -> String) -> [T] {
        let scored: [(offset: Int, item: T, score: Int)] = items.enumerated().compactMap { offset, item in
            guard let value = score(query, in: text(item)) else { return nil }
            return (offset, item, value)
        }
        return scored.sorted { $0.score == $1.score ? $0.offset < $1.offset : $0.score > $1.score }.map(\.item)
    }

    private static func walk(_ needle: [Character], haystack: [Character], original: [Character], from start: Int) -> Int? {
        var total = 0
        var previous: Int?
        var position = start
        for character in needle {
            guard let found = haystack[position...].firstIndex(of: character) else { return nil }
            total += matchScore
            if let previous, found == previous + 1 { total += consecutiveBonus }
            if let previous { total -= min(found - previous - 1, maximumGapPenalty) }
            if isBoundary(found, in: original) { total += boundaryBonus }
            previous = found
            position = found + 1
        }
        return total
    }

    /// The query appears as one piece starting at a word start, such as `login` in `fix/login`.
    private static func containsAtBoundary(_ needle: [Character], haystack: [Character], original: [Character]) -> Bool {
        guard haystack.count >= needle.count else { return false }
        return (0...(haystack.count - needle.count)).contains { start in
            isBoundary(start, in: original) && haystack[start..<(start + needle.count)].elementsEqual(needle)
        }
    }

    private static func isBoundary(_ index: Int, in text: [Character]) -> Bool {
        guard index > 0 else { return true }
        let before = text[index - 1]
        return separators.contains(before) || (before.isLowercase && text[index].isUppercase)
    }

    /// Lowercasing changed the length (rare scripts), so only exact substrings count.
    private static func substringScore(_ query: String, in candidate: String) -> Int? {
        candidate.localizedCaseInsensitiveContains(query) ? substringBonus : nil
    }
}
