import SwiftUI
import RatelGitCore

/// Diff of the selected file with layout and whitespace options, plus hunk and line staging for working changes.
struct DiffPane: View {
    @ObservedObject var model: BrowserModel
    var allowsStaging = true
    @State private var split = false
    @State private var selection: Set<Int> = []

    var body: some View {
        let document = PatchDocument(model.patch)
        let operations = stagingOperations
        VStack(spacing: 0) {
            header(operations: operations)
            Divider()
            if !selection.isEmpty, let file = model.file, !operations.isEmpty {
                selectionBar(file: file, operations: operations)
                Divider()
            }
            if model.patch.isEmpty {
                ContentUnavailableView(emptyTitle, systemImage: "doc.text.magnifyingglass")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                PatchView(document: document, split: split, staging: staging(operations))
                    .id(model.file)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onChange(of: model.patch) { _, _ in selection = [] }
    }

    private var emptyTitle: String {
        if model.file == nil { return "Select a file" }
        return model.loading ? "Reading diff…" : "No text diff"
    }

    /// Hunk and line actions apply a patch built from this exact diff, so they need a plain (not `-w`) diff.
    private var stagingOperations: [LineOperation] {
        guard allowsStaging, !model.ignoreWhitespace, let file = model.file, !file.isConflicted,
              !FilePatch(model.patch).hunks.isEmpty else { return [] }
        switch file.kind {
        case .unstaged: return [.stage, .discard]
        case .staged: return [.unstage]
        default: return []
        }
    }

    private func staging(_ operations: [LineOperation]) -> LineStaging? {
        guard !operations.isEmpty, let file = model.file else { return nil }
        let patch = model.patch
        return LineStaging(operations: operations, selection: selection, toggle: { index in
            selection = selection.symmetricDifference([index])
        }, hunk: { operation, header in
            let source = FilePatch(patch)
            guard let hunk = source.hunk(containing: header) else { return }
            run(operation, lines: Set(source.changedLines(in: hunk)), file: file, hunk: true)
        })
    }

    private func run(_ operation: LineOperation, lines: Set<Int>, file: ChangedFile, hunk: Bool) {
        if operation == .discard {
            model.confirmation = .discardLines(file, source: model.patch, lines: lines, hunk: hunk)
        } else {
            model.execute(.applyLines(file, source: model.patch, lines: lines, operation))
        }
    }

    private func header(operations: [LineOperation]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                Text(model.file.map { URL(fileURLWithPath: $0.path).lastPathComponent } ?? "Diff")
                    .font(.headline).lineLimit(1).truncationMode(.middle)
                    .help(model.file?.path ?? "")
                Spacer(minLength: 8)
                if allowsStaging, let file = model.file { FileActions(file: file, model: model) }
            }
            HStack(spacing: 10) {
                Text(model.file?.path ?? " ").font(.caption).foregroundStyle(.secondary)
                    .lineLimit(1).truncationMode(.head)
                Spacer(minLength: 8)
                Toggle("Ignore Whitespace", isOn: Binding(get: { model.ignoreWhitespace }, set: model.setIgnoreWhitespace))
                    .toggleStyle(.checkbox).controlSize(.small).fixedSize()
                    .help(allowsStaging ? "Hide whitespace-only changes. Hunk and line staging is off while this is on."
                                        : "Hide whitespace-only changes")
                Picker("Diff layout", selection: $split) {
                    Text("Unified").tag(false)
                    Text("Split").tag(true)
                }
                .pickerStyle(.segmented).labelsHidden().controlSize(.small).fixedSize()
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 7)
    }

    private func selectionBar(file: ChangedFile, operations: [LineOperation]) -> some View {
        HStack(spacing: 8) {
            Text(selection.count == 1 ? "1 line selected" : "\(selection.count) lines selected")
                .font(.caption).foregroundStyle(.secondary)
            Spacer()
            ForEach(operations, id: \.self) { operation in
                Button(operation == .discard ? "Discard Lines…" : "\(operation.rawValue) Lines") {
                    run(operation, lines: selection, file: file, hunk: false)
                }
            }
            Button("Clear") { selection = [] }
        }
        .controlSize(.small)
        .padding(.horizontal, 12).padding(.vertical, 5)
        .background(Color.accentColor.opacity(0.07))
    }
}

/// Whole-file stage, unstage and discard for the file shown in the diff.
struct FileActions: View {
    let file: ChangedFile
    @ObservedObject var model: BrowserModel

    var body: some View {
        HStack(spacing: 6) {
            switch file.kind {
            case .staged:
                Button("Unstage File") { model.execute(.unstage(file)) }
            case .unstaged, .untracked:
                Button("Stage File") { model.execute(.stage(file)) }
                if !file.isConflicted {
                    Button(file.kind == .untracked ? "Delete…" : "Discard…") { model.confirmation = .discard(file) }
                }
            case .committed:
                EmptyView()
            }
        }
        .controlSize(.small)
        .disabled(model.loading || model.mutation != nil)
    }
}
