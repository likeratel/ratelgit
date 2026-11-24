import SwiftUI
import RatelGitCore

struct SwitcherItem: Identifiable {
    enum Target {
        case project(Project)
        case worktree(Worktree)
        case branch(Reference)
    }

    let id: String
    let title: String
    let detail: String
    let symbol: String
    let target: Target

    /// Projects and worktrees of every project, and the branches of the selected one.
    @MainActor
    static func all(in model: BrowserModel) -> [SwitcherItem] {
        let projects = model.projects.filter { !$0.isUnavailable }.map { project in
            SwitcherItem(id: "project:" + project.path, title: project.name, detail: "Project · \(project.path)",
                         symbol: "shippingbox", target: .project(project))
        }
        let trees = model.projects.flatMap { project in
            project.worktrees.filter { !$0.unavailable }.map { tree in
                SwitcherItem(id: "worktree:" + tree.path, title: tree.name,
                             detail: "Worktree · \(project.name) · \(tree.branch)", symbol: "folder", target: .worktree(tree))
            }
        }
        let branches = model.references.filter { $0.kind == .local || $0.kind == .remote }.map { ref in
            SwitcherItem(id: "branch:" + ref.id, title: ref.name,
                         detail: "\(ref.kind == .local ? "Branch" : "Remote branch") · filter History",
                         symbol: ref.kind == .local ? "arrow.triangle.branch" : "network", target: .branch(ref))
        }
        return projects + trees + branches
    }
}

/// ⌘P palette: type to fuzzy-match, ↑↓ to move, Return to go, Esc to close.
struct QuickSwitcher: View {
    @ObservedObject var model: BrowserModel
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var highlighted = 0
    @FocusState private var focused: Bool
    private static let visibleLimit = 60

    var body: some View {
        let items = matches
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Jump to a project, worktree or branch", text: $query)
                    .textFieldStyle(.plain).font(.title3)
                    .focused($focused)
                    .onSubmit { choose(items) }
                    .onKeyPress(.downArrow) { move(1, count: items.count) }
                    .onKeyPress(.upArrow) { move(-1, count: items.count) }
                    .onExitCommand { dismiss() }
            }
            .padding(12)
            Divider()
            results(items)
        }
        .frame(width: 560, height: 380)
        .onAppear { focused = true }
        .onChange(of: query) { _, _ in highlighted = 0 }
    }

    @ViewBuilder
    private func results(_ items: [SwitcherItem]) -> some View {
        if items.isEmpty {
            ContentUnavailableView.search(text: query).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                            row(item, selected: index == highlighted).id(index)
                                .onTapGesture { highlighted = index; choose(items) }
                        }
                    }
                    .padding(6)
                }
                .onChange(of: highlighted) { _, index in proxy.scrollTo(index) }
            }
        }
    }

    private func row(_ item: SwitcherItem, selected: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: item.symbol).frame(width: 18).foregroundStyle(selected ? .white : .secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title).lineLimit(1)
                Text(item.detail).font(.caption).lineLimit(1).truncationMode(.middle)
                    .foregroundStyle(selected ? Color.white.opacity(0.85) : .secondary)
            }
            Spacer()
        }
        .foregroundStyle(selected ? .white : .primary)
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(selected ? Color.accentColor : .clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
    }

    private var matches: [SwitcherItem] {
        let items = SwitcherItem.all(in: model)
        guard !query.isEmpty else { return Array(items.prefix(Self.visibleLimit)) }
        return Array(FuzzyMatch.rank(items, query: query, text: \.title).prefix(Self.visibleLimit))
    }

    private func move(_ offset: Int, count: Int) -> KeyPress.Result {
        guard count > 0 else { return .handled }
        highlighted = min(max(highlighted + offset, 0), count - 1)
        return .handled
    }

    private func choose(_ items: [SwitcherItem]) {
        guard items.indices.contains(highlighted) else { return }
        dismiss()
        switch items[highlighted].target {
        case .project(let project): model.selectProject(project)
        case .worktree(let tree): model.select(tree)
        case .branch(let ref): model.filterTo(ref)
        }
    }
}
