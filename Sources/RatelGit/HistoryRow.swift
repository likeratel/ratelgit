import SwiftUI
import RatelGitCore

struct HistoryRow: View {
    let row: CommitRow
    let columns: HistoryColumnSet
    let layout: CommitGraph
    let showGraph: Bool
    let remotes: Set<String>
    @ObservedObject var model: BrowserModel

    private var selected: Bool { model.commit != nil && model.commit == row.commit.hash }

    var body: some View {
        Button { model.selectCommit(row.commit.hash) } label: {
            HStack(spacing: HistoryColumns.spacing) {
                if showGraph {
                    GraphGlyph(row: row, columns: layout.columns).frame(height: HistoryColumns.rowHeight)
                }
                HStack(spacing: 5) {
                    RefBadges(labels: row.commit.labels, remotes: remotes).layoutPriority(1)
                    Text(row.commit.title).lineLimit(1).truncationMode(.tail)
                        .fontWeight(row.commit.isHead ? .semibold : .regular)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .clipped()
                if columns.author {
                    Text(row.commit.author).lineLimit(1).foregroundStyle(.secondary)
                        .frame(width: HistoryColumns.author, alignment: .leading)
                }
                if columns.date {
                    Text(row.commit.date).monospacedDigit().lineLimit(1).foregroundStyle(.secondary)
                        .frame(width: HistoryColumns.date, alignment: .leading)
                }
                Text(row.commit.shortHash).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
                    .lineLimit(1).frame(width: HistoryColumns.hash, alignment: .leading)
            }
            .font(.callout)
            .padding(.leading, 6).padding(.trailing, 12)
            .frame(height: HistoryColumns.rowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(selected ? Color.accentColor.opacity(0.22) : Color.clear)
        .help(row.commit.title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Ref names from `%D`, styled by kind: the checked-out branch, local branches, remote branches and tags.
struct RefBadges: View {
    let labels: [String]
    let remotes: Set<String>
    private static let visibleLimit = 3

    var body: some View {
        let badges = Self.badges(labels, remotes: remotes)
        HStack(spacing: 3) {
            ForEach(Array(badges.prefix(Self.visibleLimit).enumerated()), id: \.offset) { _, badge in
                BadgeView(badge: badge)
            }
            if badges.count > Self.visibleLimit {
                Text("+\(badges.count - Self.visibleLimit)").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    .help(badges.dropFirst(Self.visibleLimit).map(\.text).joined(separator: ", "))
            }
        }
    }

    /// Classifies labels and folds `origin/x` into a local `x` badge when both point at this commit.
    static func badges(_ labels: [String], remotes: Set<String>) -> [Badge] {
        let all = labels.filter { !$0.hasSuffix("/HEAD") }.map(Badge.init(label:)).map { $0.classified(remotes: remotes) }
        let locals = Set(all.filter { $0.kind == .local || $0.kind == .head }.map(\.text))
        let folded = Set(all.filter { badge in
            guard badge.kind == .remote, let slash = badge.text.firstIndex(of: "/") else { return false }
            return locals.contains(String(badge.text[badge.text.index(after: slash)...]))
        }.map(\.text))
        return all.filter { !folded.contains($0.text) }.map { badge in
            let synced = folded.contains { $0.hasSuffix("/" + badge.text) }
            return synced ? badge.marked(remote: folded.first { $0.hasSuffix("/" + badge.text) } ?? "") : badge
        }
    }

    struct Badge {
        enum Kind { case head, local, remote, tag }
        let text: String
        let kind: Kind
        /// Remote branch at the same commit, shown as a small cloud on the local badge.
        var remote: String?

        init(label: String) {
            if label.hasPrefix("HEAD -> ") {
                (text, kind) = (String(label.dropFirst(8)), .head)
            } else if label.hasPrefix("tag: ") {
                (text, kind) = (String(label.dropFirst(5)), .tag)
            } else {
                (text, kind) = (label, label == "HEAD" ? .head : .local)
            }
        }

        private init(text: String, kind: Kind) {
            self.text = text
            self.kind = kind
        }

        func marked(remote: String) -> Badge {
            var copy = self
            copy.remote = remote
            return copy
        }

        func classified(remotes: Set<String>) -> Badge {
            kind == .local && remotes.contains(text) ? Badge(text: text, kind: .remote) : self
        }
    }

    struct BadgeView: View {
        let badge: Badge

        var body: some View {
            HStack(spacing: 2) {
                if let icon { Image(systemName: icon).font(.system(size: 8, weight: .bold)) }
                Text(Self.shortened(badge.text)).lineLimit(1)
                if badge.remote != nil { Image(systemName: "network").font(.system(size: 8, weight: .bold)) }
            }
            .help(badge.remote.map { "\(badge.text), same commit as \($0)" } ?? badge.text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(foreground)
            .padding(.horizontal, 5).padding(.vertical, 1.5)
            .background(background, in: RoundedRectangle(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(border, lineWidth: 1))
            .fixedSize()
        }

        private static let maximumCharacters = 26

        /// Long ref names keep their start and end, so `feature/…/dark-mode` stays recognisable.
        static func shortened(_ text: String) -> String {
            guard text.count > maximumCharacters else { return text }
            let half = (maximumCharacters - 1) / 2
            return String(text.prefix(half)) + "…" + String(text.suffix(half))
        }

        private var icon: String? {
            switch badge.kind {
            case .head: return "checkmark"
            case .tag: return "tag.fill"
            case .remote: return "network"
            case .local: return nil
            }
        }

        private var foreground: Color { badge.kind == .head ? .white : .primary }

        private var background: Color {
            switch badge.kind {
            case .head: return .accentColor
            case .local: return .accentColor.opacity(0.16)
            case .remote: return .secondary.opacity(0.12)
            case .tag: return .yellow.opacity(0.28)
            }
        }

        private var border: Color {
            badge.kind == .remote ? .secondary.opacity(0.35) : .clear
        }
    }
}
