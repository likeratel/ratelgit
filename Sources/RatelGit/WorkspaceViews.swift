import SwiftUI
import RatelGitCore

struct WorktreeSidebar: View {
    @ObservedObject var model: BrowserModel
    let browse: (Reference) -> Void
    @State private var search = ""
    @State private var collapsed: Set<String> = ["Remote branches", "Tags", "Stashes"]

    private var matches: [Worktree] {
        model.worktrees.filter {
            search.isEmpty || $0.name.localizedCaseInsensitiveContains(search)
                || $0.branch.localizedCaseInsensitiveContains(search)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            TextField("Find worktree", text: $search)
                .textFieldStyle(.roundedBorder).padding(10)
            Divider()
            List {
                Section("Worktrees") {
                    ForEach(matches) { tree in
                        SelectableRow(selected: model.active?.id == tree.id, action: { model.select(tree) }) {
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: tree.id == model.active?.id ? "folder.fill" : "folder")
                                    .foregroundStyle(Color.accentColor)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(tree.name).fontWeight(.medium).lineLimit(1)
                                    Text(tree.unavailable ? "Unavailable" : tree.branch)
                                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer(minLength: 2)
                                if let count = tree.changes, count > 0 {
                                    Text(count.formatted()).font(.caption.monospacedDigit())
                                        .padding(.horizontal, 5).background(.quaternary, in: Capsule())
                                }
                            }
                            .padding(.vertical, 5).padding(.horizontal, 3)
                        }
                        .help(tree.path).disabled(tree.unavailable || model.mutation != nil)
                    }
                    if matches.isEmpty { Text("No matching worktrees").foregroundStyle(.secondary) }
                }
                ForEach(["Local branches", "Remote branches", "Tags", "Stashes"], id: \.self) { group in
                    DisclosureGroup(isExpanded: expanded(group)) {
                        let refs = model.references.filter { $0.group == group }
                        if refs.isEmpty { Text("None").foregroundStyle(.secondary) }
                        ForEach(refs) { ref in
                            SelectableRow(selected: model.reference == ref, action: { browse(ref) }) {
                                Label(ref.name, systemImage: icon(group)).lineLimit(1).padding(.vertical, 3)
                            }
                            .contextMenu {
                                if group == "Local branches" {
                                    Button("Check Out in This Worktree") { model.execute(.switchBranch(ref)) }
                                }
                                if group == "Stashes" {
                                    Button("Apply in This Worktree") { model.execute(.applyStash(ref)) }
                                }
                            }
                        }
                    } label: { Text(group).fontWeight(.semibold) }
                    .disabled(model.loading || model.mutation != nil)
                }
            }
            .listStyle(.sidebar)
        }
        .background(.bar)
    }

    private func expanded(_ group: String) -> Binding<Bool> {
        Binding(get: { !collapsed.contains(group) }, set: { expanded in
            collapsed = expanded ? collapsed.subtracting([group]) : collapsed.union([group])
        })
    }

    private func icon(_ group: String) -> String {
        switch group {
        case "Stashes": return "archivebox"
        case "Tags": return "tag"
        case "Remote branches": return "cloud"
        default: return "point.topleft.down.to.point.bottomright.curvepath"
        }
    }
}

struct ChangesView: View {
    @ObservedObject var model: BrowserModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Label("Working Changes", systemImage: "square.stack")
                .font(.headline).padding(12)
            Divider()
            if model.files.isEmpty {
                ContentUnavailableView(model.loading ? "Reading changes…" : "Working tree clean",
                                       systemImage: model.loading ? "clock" : "checkmark.circle")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach([ChangeKind.unstaged, .untracked, .staged], id: \.self) { kind in
                        let matches = model.files.filter { $0.kind == kind }
                        if !matches.isEmpty {
                            Section("\(kind.rawValue)  ·  \(matches.count)") {
                                ForEach(matches) { file in
                                    HStack(spacing: 5) {
                                        FileRow(file: file, model: model)
                                        Button {
                                            model.execute(kind == .staged ? .unstage(file) : .stage(file))
                                        } label: {
                                            Image(systemName: kind == .staged ? "minus.circle" : "plus.circle")
                                        }
                                        .buttonStyle(.borderless)
                                        .help(kind == .staged ? "Unstage file" : "Stage file")
                                        .accessibilityLabel(kind == .staged ? "Unstage file" : "Stage file")
                                        .disabled(model.loading)
                                    }
                                }
                            }
                        }
                    }
                }
                .listStyle(.inset)
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                Text("Commit message").font(.subheadline.weight(.semibold))
                ZStack(alignment: .topLeading) {
                    if model.draft.isEmpty {
                        Text("Describe what changed").foregroundStyle(.secondary).padding(.leading, 6)
                            .padding(.top, 5).allowsHitTesting(false)
                    }
                    TextEditor(text: Binding(get: { model.draft }, set: { model.draft = $0 }))
                        .scrollContentBackground(.hidden).frame(minHeight: 62, maxHeight: 95)
                        .accessibilityLabel("Commit message")
                }
                .padding(4).background(.background, in: RoundedRectangle(cornerRadius: 6))
                HStack {
                    Text("\(model.files.filter { $0.kind == .staged }.count) staged")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Commit") { model.execute(.commit(model.draft)) }
                        .buttonStyle(.borderedProminent)
                        .disabled(model.loading || !model.files.contains { $0.kind == .staged }
                                  || model.files.contains { $0.status == "U" }
                                  || model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .padding(12).background(.bar)
        }
    }
}

struct FileRow: View {
    let file: ChangedFile
    @ObservedObject var model: BrowserModel

    var body: some View {
        SelectableRow(selected: model.file == file, action: { model.selectFile(file) }) {
            HStack(spacing: 7) {
                Text(file.status).font(.caption.monospaced().weight(.bold))
                    .foregroundStyle(tint)
                    .frame(width: 19, height: 19)
                    .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 4))
                Text(file.path).lineLimit(1).truncationMode(.middle)
            }
            .padding(3)
        }
        .help(file.path)
    }

    private var tint: Color {
        switch file.status {
        case "A", "?": return .green
        case "D", "U": return .red
        default: return .orange
        }
    }
}
