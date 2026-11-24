import SwiftUI
import RatelGitCore

struct Sidebar: View {
    @ObservedObject var model: BrowserModel

    var body: some View {
        VSplitView {
            ProjectList(model: model)
                .frame(minHeight: 150, idealHeight: 260, maxHeight: .infinity)
            ReferenceList(model: model)
                .frame(minHeight: 200, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background.secondary)
    }
}

struct SidebarHeader<Accessory: View>: View {
    let title: String
    @ViewBuilder var accessory: () -> Accessory

    var body: some View {
        HStack(spacing: 6) {
            Text(title.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                .lineLimit(1).truncationMode(.middle)
            Spacer(minLength: 4)
            accessory()
        }
        .padding(.horizontal, 12).padding(.top, 9).padding(.bottom, 5)
    }
}

struct ProjectList: View {
    @ObservedObject var model: BrowserModel
    @State private var collapsed: Set<String> = []

    var body: some View {
        VStack(spacing: 0) {
            SidebarHeader(title: "Projects") {
                Button("Add Repository", systemImage: "plus", action: model.chooseRepository)
                    .labelStyle(.iconOnly).buttonStyle(.borderless)
                    .help("Add a repository (⌘O)")
            }
            List {
                ForEach(model.projects) { project in
                    DisclosureGroup(isExpanded: expanded(project)) {
                        ForEach(project.worktrees) { tree in WorktreeRow(tree: tree, model: model) }
                    } label: {
                        ProjectRow(project: project, model: model)
                    }
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
        }
    }

    private func expanded(_ project: Project) -> Binding<Bool> {
        Binding(get: { !collapsed.contains(project.path) }, set: { open in
            collapsed = open ? collapsed.subtracting([project.path]) : collapsed.union([project.path])
        })
    }
}

struct ProjectRow: View {
    let project: Project
    @ObservedObject var model: BrowserModel

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: project.isUnavailable ? "exclamationmark.triangle" : "shippingbox")
                .foregroundStyle(project.isUnavailable ? Color.orange : Color.secondary)
                .frame(width: 16)
            Text(project.name).fontWeight(.semibold).lineLimit(1)
                .foregroundStyle(project.isUnavailable ? .secondary : .primary)
            Spacer(minLength: 4)
            trailing
        }
        .contentShape(Rectangle())
        .onTapGesture { if !project.isUnavailable { model.selectProject(project) } }
        .help(help)
        .contextMenu {
            Button("Remove from List") { model.removeProject(project) }
                .disabled(model.mutation != nil)
        }
    }

    @ViewBuilder
    private var trailing: some View {
        switch project.state {
        case .loading:
            ProgressView().controlSize(.mini)
        case .unavailable:
            Text("Unavailable").font(.caption).foregroundStyle(.secondary)
        case .ready:
            if project.worktrees.count > 1 {
                Text(project.worktrees.count.formatted()).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
    }

    private var help: String {
        if case .unavailable(let reason) = project.state { return "\(project.path)\n\(reason)" }
        return project.path
    }
}

struct WorktreeRow: View {
    let tree: Worktree
    @ObservedObject var model: BrowserModel

    private var selected: Bool { model.active?.id == tree.id }

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: selected ? "folder.fill" : "folder")
                .foregroundStyle(tree.unavailable ? Color.secondary : Color.accentColor)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 1) {
                Text(tree.name).fontWeight(selected ? .semibold : .regular).lineLimit(1).truncationMode(.middle)
                Text(tree.unavailable ? "Unavailable" : tree.branch)
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
            }
            Spacer(minLength: 4)
            WorktreeBadges(tree: tree)
        }
        .padding(.vertical, 3).padding(.horizontal, 6)
        .background(selected ? Color.accentColor.opacity(0.18) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture { model.select(tree) }
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
        .accessibilityAction { model.select(tree) }
        .opacity(tree.unavailable ? 0.55 : 1)
        .help(tree.path)
    }
}

struct WorktreeBadges: View {
    let tree: Worktree

    var body: some View {
        HStack(spacing: 4) {
            if let ahead = tree.ahead, let behind = tree.behind, ahead + behind > 0 {
                Text(counts(ahead: ahead, behind: behind))
                    .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                    .help("\(ahead) ahead, \(behind) behind its upstream")
            }
            if let count = tree.changes, count > 0 {
                Text(count.formatted())
                    .font(.caption2.monospacedDigit().weight(.semibold))
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(Color.orange.opacity(0.2), in: Capsule())
                    .help("\(count) changed \(count == 1 ? "file" : "files")")
            }
        }
    }

    private func counts(ahead: Int, behind: Int) -> String {
        [ahead > 0 ? "↑\(ahead)" : nil, behind > 0 ? "↓\(behind)" : nil].compactMap { $0 }.joined(separator: " ")
    }
}
