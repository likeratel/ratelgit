import SwiftUI
import RatelGitCore

struct ChangesView: View {
    @ObservedObject var model: BrowserModel
    @FocusState private var listFocused: Bool

    private static let groups: [(title: String, include: (ChangedFile) -> Bool)] = [
        ("Conflicts", { $0.isConflicted }),
        ("Unstaged", { $0.kind == .unstaged && !$0.isConflicted }),
        ("Untracked", { $0.kind == .untracked }),
        ("Staged", { $0.kind == .staged })
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Working Changes").font(.headline)
                Spacer()
                Text("Space stages or unstages").font(.caption).foregroundStyle(.tertiary)
                    .opacity(model.files.isEmpty ? 0 : 1)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            Divider()
            if model.files.isEmpty {
                ContentUnavailableView(model.loading ? "Reading changes…" : "Working tree clean",
                                       systemImage: model.loading ? "clock" : "checkmark.circle",
                                       description: Text(model.loading ? "" : "Nothing to stage or commit in this worktree."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                fileList
            }
            Divider()
            CommitBox(model: model)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var fileList: some View {
        List(selection: Binding(get: { model.file }, set: { if let file = $0 { model.selectFile(file) } })) {
            ForEach(Self.groups, id: \.title) { group in
                let matches = model.files.filter(group.include)
                if !matches.isEmpty {
                    Section("\(group.title)  ·  \(matches.count)") {
                        ForEach(matches) { file in
                            ChangeRow(file: file, model: model).tag(file)
                        }
                    }
                }
            }
        }
        .listStyle(.inset)
        .focused($listFocused)
        .onKeyPress(.space) {
            guard listFocused, let file = model.file, file.kind != .committed else { return .ignored }
            model.execute(file.kind == .staged ? .unstage(file) : .stage(file))
            return .handled
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ChangeRow: View {
    let file: ChangedFile
    @ObservedObject var model: BrowserModel
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 4) {
            FileRow(file: file)
            Spacer(minLength: 4)
            if hovering || model.file == file {
                if file.kind != .staged, !file.isConflicted {
                    iconButton(file.kind == .untracked ? "trash" : "arrow.uturn.backward",
                               help: file.kind == .untracked ? "Delete untracked file…" : "Discard changes…") {
                        model.confirmation = .discard(file)
                    }
                }
            }
            iconButton(file.kind == .staged ? "minus.circle.fill" : "plus.circle.fill",
                       help: file.kind == .staged ? "Unstage file" : "Stage file") {
                model.execute(file.kind == .staged ? .unstage(file) : .stage(file))
            }
            .foregroundStyle(file.kind == .staged ? Color.secondary : Color.green)
        }
        .onHover { hovering = $0 }
    }

    private func iconButton(_ symbol: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol) }
            .buttonStyle(.borderless)
            .help(help)
            .accessibilityLabel(help)
            .disabled(model.loading || model.mutation != nil)
    }
}

/// Status letter, file name and its folder.
struct FileRow: View {
    let file: ChangedFile

    var body: some View {
        HStack(spacing: 7) {
            Text(file.status).font(.caption.monospaced().weight(.bold))
                .foregroundStyle(tint)
                .frame(width: 19, height: 19)
                .background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 4))
            Text(name).lineLimit(1).truncationMode(.middle)
            if !folder.isEmpty {
                Text(folder).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.head)
            }
        }
        .padding(.vertical, 1)
        .help(file.path)
    }

    private var name: String {
        file.path.hasSuffix("/") ? file.path : URL(fileURLWithPath: file.path).lastPathComponent
    }

    private var folder: String {
        guard !file.path.hasSuffix("/"), let slash = file.path.lastIndex(of: "/") else { return "" }
        return String(file.path[..<slash])
    }

    private var tint: Color {
        switch file.status {
        case "A", "?": return .green
        case "D", "U": return .red
        default: return .orange
        }
    }
}

struct CommitBox: View {
    @ObservedObject var model: BrowserModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .topLeading) {
                if model.draft.isEmpty {
                    Text("Commit message").foregroundStyle(.secondary).padding(.leading, 6)
                        .padding(.top, 5).allowsHitTesting(false)
                }
                TextEditor(text: Binding(get: { model.draft }, set: { model.draft = $0 }))
                    .scrollContentBackground(.hidden).frame(minHeight: 58, maxHeight: 92)
                    .accessibilityLabel("Commit message")
            }
            .padding(4)
            .background(.background, in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.separator))
            HStack {
                Text(status).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Commit") { model.execute(.commit(model.draft)) }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canCommit)
            }
        }
        .padding(12).background(.bar)
    }

    private var staged: Int { model.files.filter { $0.kind == .staged }.count }

    private var status: String {
        if model.files.contains(where: \.isConflicted) { return "Resolve conflicts before committing" }
        return staged == 1 ? "1 file staged" : "\(staged) files staged"
    }

    private var canCommit: Bool {
        !model.loading && staged > 0 && !model.files.contains(where: \.isConflicted)
            && !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
