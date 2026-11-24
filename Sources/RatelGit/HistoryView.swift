import SwiftUI
import RatelGitCore

struct HistoryView: View {
    @ObservedObject var model: BrowserModel
    @Binding var query: String

    var body: some View {
        let graph = CommitGraph(model.graph)
        let visible = query.isEmpty ? graph.rows : graph.rows.filter { matches($0.commit) }
        VStack(spacing: 0) {
            HStack {
                Text(model.reference?.name ?? "HEAD history").font(.headline).lineLimit(1)
                Spacer()
                if model.reference != nil { Button("HEAD") { model.browse(nil) } }
                TextField("Search commits", text: $query).textFieldStyle(.roundedBorder).frame(maxWidth: 165)
            }
            .padding(12)
            Divider()
            if graph.rows.isEmpty {
                ContentUnavailableView(model.loading ? "Reading history…" : "No commits", systemImage: "clock")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if visible.isEmpty {
                ContentUnavailableView.search(text: query)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView([.horizontal, .vertical]) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(visible) { row in
                            commitRow(row, columns: graph.columns, showGraph: query.isEmpty)
                        }
                    }
                    .padding(.horizontal, 6)
                }
                .defaultScrollAnchor(.topLeading)
            }
        }
    }

    private func matches(_ commit: GraphLine) -> Bool {
        ([commit.title, commit.author, commit.shortHash, commit.hash ?? "", commit.date] + commit.labels)
            .contains { $0.localizedCaseInsensitiveContains(query) }
    }

    private func commitRow(_ row: CommitRow, columns: Int, showGraph: Bool) -> some View {
        SelectableRow(selected: model.commit == row.commit.hash, action: { model.selectCommit(row.commit.hash) }) {
            HStack(spacing: 8) {
                if showGraph { GraphGlyph(row: row, columns: columns) }
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        ForEach(row.commit.labels, id: \.self) { label in
                            Text(label).font(.caption2.weight(.semibold)).lineLimit(1)
                                .padding(.horizontal, 5).padding(.vertical, 2)
                                .background(Color.accentColor.opacity(0.14), in: Capsule())
                        }
                        Text(row.commit.title).lineLimit(1).font(.system(.subheadline, weight: .medium))
                    }
                    Text("\(row.commit.shortHash)  ·  \(row.commit.author)  ·  \(row.commit.date)")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 9)
            }
            .padding(.leading, showGraph ? 0 : 7)
            .frame(height: 42)
        }
        .help(row.commit.title)
    }
}
