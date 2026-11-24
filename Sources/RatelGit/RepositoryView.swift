import SwiftUI
import RatelGitCore

struct RepositoryView: View {
    @ObservedObject var model: BrowserModel

    var body: some View {
        VStack(spacing: 0) {
            if model.projects.isEmpty && model.active == nil {
                welcome
            } else {
                HSplitView {
                    Sidebar(model: model)
                        .frame(minWidth: Layout.sidebar.min, idealWidth: Layout.sidebar.ideal, maxWidth: Layout.sidebar.max,
                               maxHeight: .infinity)
                    workspace
                        .frame(minWidth: Layout.center.min + Layout.inspector.min, maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            if let error = model.error { ErrorBar(message: error, dismiss: model.dismissError) }
            Divider()
            StatusBar(model: model)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .modifier(DialogPresenter(model: model))
        .sheet(isPresented: $model.switcherVisible) { QuickSwitcher(model: model) }
    }

    @ViewBuilder
    private var workspace: some View {
        if model.active == nil {
            ContentUnavailableView("Select a worktree", systemImage: "folder",
                                   description: Text("Choose a worktree in the sidebar, or press ⌘P to jump to one."))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack(spacing: 0) {
                WorkspaceHeader(model: model)
                Divider()
                if let operation = model.operation { OperationBanner(operation: operation, model: model) }
                panes
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .disabled(model.mutation != nil)
            }
        }
    }

    /// History stacks the commit list above the commit detail; Changes keeps the file list beside the diff.
    @ViewBuilder
    private var panes: some View {
        switch model.mode {
        case .history:
            VSplitView {
                HistoryView(model: model)
                    .frame(maxWidth: .infinity, minHeight: Layout.historyList.min, idealHeight: Layout.historyList.ideal,
                           maxHeight: .infinity)
                CommitInspector(model: model)
                    .frame(maxWidth: .infinity, minHeight: Layout.commitDetail.min, idealHeight: Layout.commitDetail.ideal,
                           maxHeight: .infinity)
            }
        case .changes:
            HSplitView {
                ChangesView(model: model)
                    .frame(minWidth: Layout.center.min, idealWidth: Layout.center.ideal,
                           maxWidth: .infinity, maxHeight: .infinity)
                DiffPane(model: model)
                    .frame(minWidth: Layout.inspector.min, idealWidth: Layout.inspector.ideal,
                           maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var welcome: some View {
        ContentUnavailableView {
            Label("Open a Git repository", systemImage: "point.3.connected.trianglepath.dotted")
        } description: {
            Text("Add repositories to the sidebar, then move between their worktrees to read history, changes and diffs.")
        } actions: {
            Button("Open Repository…", action: model.chooseRepository)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Branch, upstream counts, the History/Changes switch and remote actions for the selected worktree.
struct WorkspaceHeader: View {
    @ObservedObject var model: BrowserModel

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(model.active?.name ?? "").font(.system(.headline)).lineLimit(1)
                HStack(spacing: 6) {
                    Label(model.active?.branch ?? "", systemImage: "arrow.triangle.branch")
                        .lineLimit(1)
                    if let tracking = model.tracking {
                        Text("↑\(tracking.ahead) ↓\(tracking.behind)").monospacedDigit()
                            .help("Compared with \(tracking.remote)/\(tracking.target.replacingOccurrences(of: "refs/heads/", with: ""))")
                    } else {
                        Text("No upstream")
                    }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            .frame(minWidth: 80, maxWidth: 260, alignment: .leading)
            Spacer(minLength: 8)
            Picker("Workspace", selection: Binding(get: { model.mode }, set: model.setMode)) {
                Text("History").tag(WorkspaceMode.history)
                Text(changesTitle).tag(WorkspaceMode.changes)
            }
            .labelsHidden().pickerStyle(.segmented).fixedSize()
            Spacer(minLength: 8)
            remoteButtons
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(.bar)
    }

    private var changesTitle: String {
        model.files.isEmpty ? "Changes" : "Changes (\(Set(model.files.map(\.path)).count))"
    }

    private var remoteButtons: some View {
        HStack(spacing: 6) {
            Button("Fetch", systemImage: "arrow.down.to.line") { model.execute(.fetch) }
            Button("Pull", systemImage: "arrow.down") { model.execute(.pull) }
                .disabled(model.tracking == nil || model.tracking?.remote == ".")
            Button("Push", systemImage: "arrow.up") { model.execute(.push) }
                .disabled(model.tracking == nil || model.tracking?.remote == ".")
            Menu {
                Button("New Branch…") { model.ask(.createBranch) }
                Button("Stash Changes…") { model.ask(.stash) }
                Divider()
                Button("Refresh", action: model.refresh)
            } label: { Label("More", systemImage: "ellipsis.circle") }
            .menuIndicator(.hidden).fixedSize()
        }
        .labelStyle(.titleAndIcon)
        .fixedSize()
        .controlSize(.small)
        .disabled(model.loading || model.mutation != nil)
    }
}

struct OperationBanner: View {
    let operation: RepositoryOperation
    @ObservedObject var model: BrowserModel

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            Text(message).font(.callout).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Button("Show Changes") { model.setMode(.changes) }
            Button("Abort \(operation.rawValue)…", role: .destructive) {
                model.confirmation = Confirmation(
                    title: "Abort \(operation.rawValue)?",
                    message: "The worktree returns to where it was before the \(operation.rawValue.lowercased()). "
                        + "Conflict resolutions you made are lost.",
                    button: "Abort \(operation.rawValue)", action: .abort(operation))
            }
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 7)
        .background(Color.orange.opacity(0.13))
        .overlay(alignment: .bottom) { Divider() }
    }

    private var message: String {
        switch operation {
        case .merge:
            return "Merge in progress. Resolve the conflicted files in Changes, stage them and commit."
        case .rebase:
            return "Rebase stopped. Resolve and stage the conflicts, then run git rebase --continue in Terminal."
        }
    }
}

struct ErrorBar: View {
    let message: String
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top) {
            Label(message, systemImage: "exclamationmark.circle.fill")
                .foregroundStyle(.red).textSelection(.enabled).lineLimit(4)
            Spacer()
            Button("Dismiss", systemImage: "xmark", action: dismiss).labelStyle(.iconOnly).buttonStyle(.borderless)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Color.red.opacity(0.08))
        .overlay(alignment: .top) { Divider() }
    }
}

struct StatusBar: View {
    @ObservedObject var model: BrowserModel

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "folder").foregroundStyle(.secondary)
            Text(model.active?.path ?? "No worktree selected").lineLimit(1).truncationMode(.middle)
            Spacer()
            if let mutation = model.mutation {
                ProgressView().controlSize(.small)
                Text(mutation + "…")
            } else if model.loading || model.loadingPage {
                ProgressView().controlSize(.small)
                Text("Loading…")
            } else if model.active != nil {
                Text(commitSummary)
            }
        }
        .font(.caption).foregroundStyle(.secondary)
        .padding(.horizontal, 12).padding(.vertical, 5).background(.bar)
    }

    private var commitSummary: String {
        let count = model.history.lines.count.formatted()
        return model.history.complete ? "\(count) commits" : "\(count) commits loaded, more below"
    }
}

/// Presents confirmations and text prompts the model asks for.
struct DialogPresenter: ViewModifier {
    @ObservedObject var model: BrowserModel

    func body(content: Content) -> some View {
        content
            .alert(model.confirmation?.title ?? "", isPresented: present(\.confirmation), presenting: model.confirmation) { item in
                Button("Cancel", role: .cancel) {}
                Button(item.button, role: .destructive) { model.run(item) }
            } message: { item in Text(item.message) }
            .alert(model.prompt?.title ?? "", isPresented: present(\.prompt), presenting: model.prompt) { item in
                TextField(item.placeholder, text: $model.promptText)
                Button("Cancel", role: .cancel) {}
                Button(item.button) { model.submit(item) }
            } message: { item in Text(item.message) }
    }

    private func present<T>(_ keyPath: ReferenceWritableKeyPath<BrowserModel, T?>) -> Binding<Bool> {
        Binding(get: { model[keyPath: keyPath] != nil }, set: { shown in
            if !shown { model[keyPath: keyPath] = nil }
        })
    }
}
