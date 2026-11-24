import SwiftUI
import RatelGitCore

enum HistoryColumns {
    static let rowHeight: CGFloat = 26
    static let author: CGFloat = 116
    static let date: CGFloat = 78
    static let hash: CGFloat = 62
    static let spacing: CGFloat = 10
    /// Below these list widths the author and date columns are hidden so messages stay readable.
    static let authorBreakpoint: CGFloat = 600
    static let dateBreakpoint: CGFloat = 470
}

struct HistoryColumnSet {
    let author: Bool
    let date: Bool

    init(width: CGFloat) {
        author = width >= HistoryColumns.authorBreakpoint
        date = width >= HistoryColumns.dateBreakpoint
    }
}

struct HistoryView: View {
    @ObservedObject var model: BrowserModel
    @State private var query = ""

    var body: some View {
        let layout = model.history.layout
        let searching = !query.isEmpty
        let rows = searching ? layout.rows.filter { matches($0.commit) } : layout.rows
        VStack(spacing: 0) {
            header
            if !model.filter.isEmpty { FilterBar(model: model) }
            Divider()
            GeometryReader { geometry in
                let columns = HistoryColumnSet(width: geometry.size.width)
                VStack(spacing: 0) {
                    ColumnHeader(columns: columns, graphWidth: searching ? 0 : GraphStyle.width(columns: layout.columns))
                    Divider()
                    content(rows: rows, layout: layout, columns: columns, searching: searching)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text("History").font(.headline)
            Spacer(minLength: 8)
            TextField("Search loaded commits", text: $query)
                .textFieldStyle(.roundedBorder).frame(maxWidth: 220)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    @ViewBuilder
    private func content(rows: [CommitRow], layout: CommitGraph, columns: HistoryColumnSet, searching: Bool) -> some View {
        if layout.rows.isEmpty && model.files.isEmpty {
            ContentUnavailableView(model.loading ? "Reading history…" : model.filter.isEmpty ? "No commits" : "No commits match the filter",
                                   systemImage: model.loading ? "clock" : "point.3.connected.trianglepath.dotted")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if searching && rows.isEmpty {
            ContentUnavailableView.search(text: query)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if !searching && !model.files.isEmpty && !model.history.headHidden {
                            UncommittedRow(count: Set(model.files.map(\.path)).count,
                                           graphWidth: GraphStyle.width(columns: layout.columns)) { model.setMode(.changes) }
                        }
                        let remotes = Set(model.references.lazy.filter { $0.kind == .remote }.map(\.name))
                        ForEach(rows) { row in
                            HistoryRow(row: row, columns: columns, layout: layout, showGraph: !searching,
                                       remotes: remotes, model: model)
                                .id(row.id)
                        }
                        if !searching && !model.history.complete { PageFooter(model: model) }
                    }
                }
                .onChange(of: model.commit) { _, hash in
                    guard let hash, let row = layout.rows.first(where: { $0.commit.hash == hash }) else { return }
                    withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(row.id) }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func matches(_ commit: GraphLine) -> Bool {
        ([commit.title, commit.author, commit.shortHash, commit.hash ?? "", commit.date] + commit.labels)
            .contains { $0.localizedCaseInsensitiveContains(query) }
    }
}

struct ColumnHeader: View {
    let columns: HistoryColumnSet
    let graphWidth: CGFloat

    var body: some View {
        HStack(spacing: HistoryColumns.spacing) {
            Color.clear.frame(width: max(graphWidth - HistoryColumns.spacing, 0), height: 1)
            Text("Description").frame(maxWidth: .infinity, alignment: .leading)
            if columns.author { Text("Author").frame(width: HistoryColumns.author, alignment: .leading) }
            if columns.date { Text("Date").frame(width: HistoryColumns.date, alignment: .leading) }
            Text("Commit").frame(width: HistoryColumns.hash, alignment: .leading)
        }
        .font(.caption.weight(.medium)).foregroundStyle(.secondary).lineLimit(1)
        .padding(.leading, 6).padding(.trailing, 12).padding(.vertical, 4)
    }
}

/// Shows which refs the history is limited to, with a way back to every branch.
struct FilterBar: View {
    @ObservedObject var model: BrowserModel

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "line.3.horizontal.decrease.circle.fill").foregroundStyle(Color.accentColor)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 5) {
                    ForEach(model.filter.refs.sorted(), id: \.self) { ref in chip(ref) }
                }
            }
            if model.history.headHidden {
                Label("HEAD not shown", systemImage: "eye.slash").font(.caption).foregroundStyle(.secondary)
                    .lineLimit(1).fixedSize()
                    .help("The commit this worktree has checked out is not on the filtered branches.")
            }
            Button("Clear", action: model.clearFilter).controlSize(.small)
        }
        .padding(.horizontal, 12).padding(.vertical, 5)
        .background(Color.accentColor.opacity(0.07))
    }

    private func chip(_ ref: String) -> some View {
        HStack(spacing: 3) {
            Text(name(ref)).lineLimit(1)
            Button { model.removeFromFilter(ref) } label: { Image(systemName: "xmark").font(.system(size: 8, weight: .bold)) }
                .buttonStyle(.borderless)
                .accessibilityLabel("Remove \(name(ref)) from filter")
        }
        .font(.caption.weight(.medium))
        .padding(.horizontal, 7).padding(.vertical, 2)
        .background(Color.accentColor.opacity(0.16), in: Capsule())
    }

    private func name(_ ref: String) -> String {
        if ref == HistoryFilter.head { return "Current branch (\(model.active?.branch ?? "HEAD"))" }
        return model.references.first { $0.id == ref }?.name ?? ref
    }
}

struct PageFooter: View {
    @ObservedObject var model: BrowserModel

    var body: some View {
        HStack(spacing: 8) {
            if model.loadingPage {
                ProgressView().controlSize(.small)
                Text("Loading more commits…")
            } else {
                Button("Load More Commits", action: model.loadMoreHistory).controlSize(.small)
            }
        }
        .font(.caption).foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, minHeight: 34)
        .onAppear(perform: model.loadMoreHistory)
    }
}

struct UncommittedRow: View {
    let count: Int
    let graphWidth: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: HistoryColumns.spacing) {
                Image(systemName: "circle.dashed").font(.system(size: 11, weight: .bold)).foregroundStyle(.orange)
                    .frame(width: max(graphWidth - HistoryColumns.spacing, 12), alignment: .leading)
                    .padding(.leading, GraphStyle.inset / 2 + 1)
                Text("Uncommitted changes (\(count))").fontWeight(.medium).foregroundStyle(.orange)
                Spacer()
            }
            .frame(height: HistoryColumns.rowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.leading, 6)
        .help("Show the working changes of this worktree (⌘2)")
    }
}
