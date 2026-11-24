import SwiftUI
import RatelGitCore

@main
struct RatelGitApp: App {
    @StateObject private var model = BrowserModel()

    var body: some Scene {
        Window("ratelgit", id: "repository") {
            RepositoryView(model: model)
                .frame(minWidth: 1050, minHeight: 630)
                .onOpenURL { model.open($0) }
        }
        .defaultSize(width: 1460, height: 850)
        .commands {
            CommandGroup(after: .newItem) {
                Button("Open Repository…", action: model.chooseRepository).keyboardShortcut("o")
                Button("Refresh Repository", action: model.refresh).keyboardShortcut("r")
                Divider()
                Button("Previous Worktree") { model.move(-1) }
                    .keyboardShortcut("[", modifiers: [.command, .option])
                Button("Next Worktree") { model.move(1) }
                    .keyboardShortcut("]", modifiers: [.command, .option])
            }
        }
    }
}

enum WorkspaceMode: String, CaseIterable {
    case changes = "Changes"
    case history = "History"
}

struct RepositoryView: View {
    @ObservedObject var model: BrowserModel
    @State private var mode = WorkspaceMode.changes
    @State private var query = ""
    @State private var branchName = ""
    @State private var stashMessage = ""
    @State private var creatingBranch = false
    @State private var savingStash = false

    var body: some View {
        VStack(spacing: 0) {
            if model.active == nil { welcome }
            else { workspace }
            if let error = model.error { errorBar(error) }
        }
        .toolbar { ToolbarItem(placement: .principal) { repositoryMenu } }
        .alert("Create and Switch to Branch", isPresented: $creatingBranch) {
            TextField("Branch name", text: $branchName)
            Button("Cancel", role: .cancel) {}
            Button("Create") { model.execute(.createBranch(branchName)) }
        } message: { Text("Create a branch from the current worktree’s HEAD.") }
        .alert("Stash Changes", isPresented: $savingStash) {
            TextField("Message (optional)", text: $stashMessage)
            Button("Cancel", role: .cancel) {}
            Button("Stash") { model.execute(.stash(stashMessage)) }
        } message: { Text("Save staged, unstaged, and untracked changes from this worktree.") }
    }

    private var workspace: some View {
        VStack(spacing: 0) {
            controls
            Divider()
            HSplitView {
                WorktreeSidebar(model: model, browse: { ref in
                    mode = .history
                    model.browse(ref)
                })
                .frame(minWidth: 190, idealWidth: 222, maxWidth: 330)

                Group {
                    switch mode {
                    case .changes:
                        ChangesView(model: model)
                    case .history:
                        HistoryView(model: model, query: $query)
                    }
                }
                .frame(minWidth: 330, idealWidth: 490)
                .disabled(model.mutation != nil)

                DiffInspector(model: model, includeFiles: mode == .history)
                    .frame(minWidth: 390, idealWidth: 610)
                    .disabled(model.mutation != nil)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            statusBar
        }
    }

    private var controls: some View {
        HStack(spacing: 12) {
            Label(model.active?.branch ?? "", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                .font(.system(.subheadline, weight: .semibold)).lineLimit(1)
            if let tracking = model.tracking {
                Text("↑\(tracking.ahead)  ↓\(tracking.behind)")
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    .help("Compared with the locally known upstream")
            } else {
                Text("No upstream").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Picker("Workspace", selection: $mode) {
                ForEach(WorkspaceMode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .labelsHidden().pickerStyle(.segmented).frame(width: 180)
            .onChange(of: mode) { _, next in
                if next == .changes, model.commit != nil { model.selectCommit(nil) }
            }
            Spacer()
            Group {
                Button("Fetch", systemImage: "arrow.down.to.line") { model.execute(.fetch) }
                Button("Pull", systemImage: "arrow.down") { model.execute(.pull) }
                    .disabled(model.tracking == nil || model.tracking?.remote == ".")
                Button("Push", systemImage: "arrow.up") { model.execute(.push) }
                    .disabled(model.tracking == nil || model.tracking?.remote == ".")
                Divider().frame(height: 16)
                Menu {
                    Button("New Branch…") { branchName = ""; creatingBranch = true }
                    Button("Stash Changes…") { stashMessage = ""; savingStash = true }
                    Button("Refresh", action: model.refresh)
                } label: { Label("Actions", systemImage: "ellipsis.circle") }
                .fixedSize()
            }
            .controlSize(.small)
            .disabled(model.loading || model.mutation != nil)
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(.bar)
    }

    private var statusBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "folder").foregroundStyle(.secondary)
            Text(model.active?.path ?? "").lineLimit(1).truncationMode(.middle)
            Spacer()
            if let mutation = model.mutation {
                ProgressView().controlSize(.small)
                Text(mutation)
            } else if model.loading {
                ProgressView().controlSize(.small)
                Text("Loading…")
            } else {
                Text("\(model.graph.lazy.filter { $0.hash != nil }.count) commits in view")
            }
        }
        .font(.caption).foregroundStyle(.secondary)
        .padding(.horizontal, 12).padding(.vertical, 6).background(.bar)
    }

    private var repositoryMenu: some View {
        Menu {
            Button("Open Repository…", action: model.chooseRepository)
            if !model.recent.isEmpty {
                Divider()
                ForEach(model.recent, id: \.self) { path in
                    Button(path) { model.open(URL(fileURLWithPath: path)) }
                }
            }
        } label: {
            Label(model.active?.name ?? "ratelgit", systemImage: "folder")
                .font(.headline)
        }
        .fixedSize()
        .disabled(model.mutation != nil)
    }

    private var welcome: some View {
        ContentUnavailableView {
            Label("Open a Git repository", systemImage: "point.3.connected.trianglepath.dotted")
        } description: {
            Text("Choose a repository or linked worktree to inspect its changes and history.")
        } actions: {
            Button("Open Repository…", action: model.chooseRepository)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorBar(_ message: String) -> some View {
        HStack {
            Label(message, systemImage: "exclamationmark.circle")
                .foregroundStyle(.red).textSelection(.enabled)
            Spacer()
            Button("Dismiss", systemImage: "xmark", action: model.dismissError).labelStyle(.iconOnly)
        }
        .padding(10).background(.bar)
    }
}

struct SelectableRow<Content: View>: View {
    let selected: Bool
    let action: () -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        Button(action: action) {
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(selected ? Color.accentColor.opacity(0.17) : .clear,
                    in: RoundedRectangle(cornerRadius: 5))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
