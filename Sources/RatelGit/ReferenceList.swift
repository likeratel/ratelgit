import SwiftUI
import RatelGitCore

/// Branches, remotes, tags and stashes of the selected project, read from the selected worktree.
struct ReferenceList: View {
    @ObservedObject var model: BrowserModel
    @State private var expanded: Set<String> = []
    @State private var collapsed: Set<String> = []
    @State private var closedSections: Set<ReferenceKind> = [.tag]

    var body: some View {
        VStack(spacing: 0) {
            SidebarHeader(title: model.project?.name ?? "References") {
                if !model.filter.isEmpty {
                    Image(systemName: "line.3.horizontal.decrease.circle.fill").foregroundStyle(Color.accentColor)
                        .help("History is filtered")
                }
            }
            List {
                ForEach(ReferenceKind.allCases, id: \.self) { kind in
                    Section(isExpanded: sectionBinding(kind)) {
                        rows(kind)
                    } header: {
                        Text(title(kind))
                    }
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
            .overlay {
                if model.references.isEmpty && model.loading {
                    ProgressView().controlSize(.small)
                }
            }
        }
    }

    @ViewBuilder
    private func rows(_ kind: ReferenceKind) -> some View {
        let refs = model.references.filter { $0.kind == kind }
        if refs.isEmpty {
            Text(model.loading ? "Loading…" : "None").foregroundStyle(.secondary).font(.callout)
        } else if kind == .local || kind == .remote {
            BranchTreeRows(nodes: BranchTree.build(refs), model: model, expansion: expansion)
        } else {
            ForEach(refs) { ref in RefRow(reference: ref, title: ref.name, model: model) }
        }
    }

    private func title(_ kind: ReferenceKind) -> String {
        switch kind {
        case .local: return "Branches"
        case .remote: return "Remotes"
        case .tag: return "Tags"
        case .stash: return "Stashes"
        }
    }

    private func sectionBinding(_ kind: ReferenceKind) -> Binding<Bool> {
        Binding(get: { !closedSections.contains(kind) }, set: { open in
            closedSections = open ? closedSections.subtracting([kind]) : closedSections.union([kind])
        })
    }

    /// Local folders and remote names start open, as do folders holding HEAD or a filtered branch.
    private func expansion(_ node: BranchNode) -> Binding<Bool> {
        let automatic = node.references.contains { $0.isHead || model.filter.contains($0) }
            || node.references.first?.kind == .local || !node.path.contains("/")
        return Binding(get: { expanded.contains(node.id) || (automatic && !collapsed.contains(node.id)) }, set: { open in
            expanded = open ? expanded.union([node.id]) : expanded.subtracting([node.id])
            collapsed = open ? collapsed.subtracting([node.id]) : collapsed.union([node.id])
        })
    }
}

struct BranchTreeRows: View {
    let nodes: [BranchNode]
    @ObservedObject var model: BrowserModel
    let expansion: (BranchNode) -> Binding<Bool>

    var body: some View {
        ForEach(nodes) { node in
            if node.isFolder {
                DisclosureGroup(isExpanded: expansion(node)) {
                    if let ref = node.reference { RefRow(reference: ref, title: node.name, model: model) }
                    BranchTreeRows(nodes: node.children, model: model, expansion: expansion)
                } label: {
                    FolderRow(node: node, model: model)
                }
            } else if let ref = node.reference {
                RefRow(reference: ref, title: node.name, model: model)
            }
        }
    }
}

struct FolderRow: View {
    let node: BranchNode
    @ObservedObject var model: BrowserModel
    @State private var hovering = false

    var body: some View {
        let refs = node.references
        let on = !refs.isEmpty && refs.allSatisfy(model.filter.contains)
        HStack(spacing: 6) {
            Image(systemName: isRemoteRoot ? "network" : "folder").foregroundStyle(.secondary).frame(width: 16)
            Text(node.name).lineLimit(1).truncationMode(.middle)
            Spacer(minLength: 4)
            FilterToggle(on: on, visible: hovering, help: "Show only commits on branches in \(node.path)") {
                model.toggleFilter(refs)
            }
        }
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .contextMenu {
            Button(on ? "Remove from Filter" : "Filter to Branches in “\(node.path)”") { model.toggleFilter(refs) }
        }
    }

    private var isRemoteRoot: Bool { node.references.first?.kind == .remote && !node.path.contains("/") }
}

struct RefRow: View {
    let reference: Reference
    let title: String
    @ObservedObject var model: BrowserModel
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon).foregroundStyle(reference.isHead ? Color.accentColor : Color.secondary).frame(width: 16)
            Text(title).fontWeight(reference.isHead ? .semibold : .regular).lineLimit(1).truncationMode(.middle)
            Spacer(minLength: 4)
            if let elsewhere = otherWorktree {
                Image(systemName: "square.on.square").font(.caption).foregroundStyle(.secondary)
                    .help("Checked out in worktree “\(URL(fileURLWithPath: elsewhere).lastPathComponent)” at \(elsewhere)")
            }
            if reference.kind != .stash {
                FilterToggle(on: model.filter.contains(reference), visible: hovering,
                             help: "Show only commits reachable from \(reference.name)") {
                    model.toggleFilter([reference])
                }
            }
        }
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture { model.reveal(reference) }
        .help(help)
        .contextMenu { ReferenceMenu(reference: reference, model: model) }
    }

    private var otherWorktree: String? {
        guard let path = reference.worktreePath, path != model.active?.path else { return nil }
        return path
    }

    private var icon: String {
        switch reference.kind {
        case .local: return reference.isHead ? "checkmark.circle.fill" : "arrow.triangle.branch"
        case .remote: return "arrow.triangle.branch"
        case .tag: return "tag"
        case .stash: return "archivebox"
        }
    }

    private var help: String {
        reference.isHead ? "\(reference.name) — checked out in this worktree" : reference.name
    }
}

/// Funnel button that limits History to a branch or folder. Hidden until hover unless it is on.
struct FilterToggle: View {
    let on: Bool
    let visible: Bool
    let help: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: on ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                .foregroundStyle(on ? Color.accentColor : Color.secondary)
        }
        .buttonStyle(.borderless)
        .opacity(on || visible ? 1 : 0)
        .help(on ? "Remove from the history filter" : help)
        .accessibilityLabel(on ? "Remove from history filter" : "Add to history filter")
    }
}
