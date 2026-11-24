import SwiftUI
import RatelGitCore

/// Right side of History: the selected commit's message and metadata, its files, and the file diff.
struct CommitInspector: View {
    @ObservedObject var model: BrowserModel

    var body: some View {
        if model.commit == nil {
            ContentUnavailableView("Select a commit", systemImage: "point.3.connected.trianglepath.dotted",
                                   description: Text("Choose a commit to read its message, changed files and diff."))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VSplitView {
                VStack(spacing: 0) {
                    if let detail = model.detail {
                        CommitSummary(detail: detail, model: model)
                    } else {
                        ProgressView().controlSize(.small).frame(maxWidth: .infinity, minHeight: 90)
                    }
                    Divider()
                    files
                }
                .frame(minHeight: 200, idealHeight: 290, maxHeight: .infinity)
                DiffPane(model: model, allowsStaging: false)
                    .frame(minHeight: 220, maxHeight: .infinity)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private var files: some View {
        if model.commitFiles.isEmpty {
            ContentUnavailableView(model.loading ? "Reading files…" : "No changed files", systemImage: "doc")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(selection: Binding(get: { model.file }, set: { if let file = $0 { model.selectFile(file) } })) {
                Section("\(model.commitFiles.count) changed \(model.commitFiles.count == 1 ? "file" : "files")") {
                    ForEach(model.commitFiles) { file in FileRow(file: file).tag(file) }
                }
            }
            .listStyle(.inset)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct CommitSummary: View {
    let detail: CommitDetail
    @ObservedObject var model: BrowserModel
    private static let bodyHeight: CGFloat = 96

    var body: some View {
        let (subject, message) = split(detail.message)
        VStack(alignment: .leading, spacing: 8) {
            Text(subject).font(.headline).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                .lineLimit(3)
            if !message.isEmpty {
                ScrollView {
                    Text(message).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: Self.bodyHeight)
                .fixedSize(horizontal: false, vertical: true)
            }
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 10, verticalSpacing: 3) {
                GridRow {
                    label("Author")
                    Text("\(detail.author) <\(detail.email)>").lineLimit(1).truncationMode(.middle)
                }
                GridRow { label("Date"); Text(formattedDate) }
                GridRow {
                    label("Commit")
                    Text(detail.hash).font(.system(.caption, design: .monospaced)).lineLimit(1).truncationMode(.middle)
                }
                GridRow { label(detail.parents.count == 1 ? "Parent" : "Parents"); parents }
            }
            .font(.callout).textSelection(.enabled)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var parents: some View {
        HStack(spacing: 6) {
            if detail.parents.isEmpty { Text("None").foregroundStyle(.secondary) }
            ForEach(detail.parents, id: \.self) { parent in
                Button(String(parent.prefix(9))) { model.selectCommit(parent) }
                    .buttonStyle(.link).font(.system(.caption, design: .monospaced))
                    .help("Show parent \(parent)")
            }
        }
    }

    private func label(_ text: String) -> some View {
        Text(text).foregroundStyle(.secondary).gridColumnAlignment(.trailing)
    }

    private var formattedDate: String {
        guard let date = ISO8601DateFormatter().date(from: detail.date) else { return detail.date }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    private func split(_ text: String) -> (String, String) {
        let parts = text.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
        let subject = parts.first.map(String.init) ?? ""
        let rest = parts.count > 1 ? String(parts[1]).trimmingCharacters(in: .whitespacesAndNewlines) : ""
        return (subject, rest)
    }
}
