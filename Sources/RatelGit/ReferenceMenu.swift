import SwiftUI
import RatelGitCore

/// Context menu for a branch, remote branch, tag or stash in the sidebar.
struct ReferenceMenu: View {
    let reference: Reference
    @ObservedObject var model: BrowserModel

    var body: some View {
        switch reference.kind {
        case .local: localItems
        case .remote:
            Button("Check Out as Local Tracking Branch") { model.execute(.checkoutRemote(reference)) }
            Divider()
            filterItems
        case .tag:
            filterItems
        case .stash:
            Button("Apply in This Worktree") { model.execute(.applyStash(reference)) }
            Divider()
            Button("Drop…", role: .destructive) { model.confirmation = .dropStash(reference) }
        }
    }

    private var checkedOutElsewhere: Bool {
        reference.worktreePath != nil && reference.worktreePath != model.active?.path
    }

    @ViewBuilder
    private var localItems: some View {
        Button("Check Out") { model.execute(.switchBranch(reference)) }
            .disabled(reference.isHead || checkedOutElsewhere)
        Button("Merge into Current Branch") { model.execute(.merge(reference)) }
            .disabled(reference.isHead)
        Button("Rebase Current Branch onto This") { model.execute(.rebase(onto: reference)) }
            .disabled(reference.isHead)
        Divider()
        Button("Check Out in New Worktree…") {
            if let project = model.project { model.ask(.addWorktree(reference, projectPath: project.path)) }
        }
        .disabled(reference.worktreePath != nil)
        Divider()
        Button("Rename…") { model.ask(.rename(reference)) }
        Button("Delete…", role: .destructive) { model.confirmation = .deleteBranch(reference) }
            .disabled(reference.worktreePath != nil)
        Divider()
        filterItems
    }

    @ViewBuilder
    private var filterItems: some View {
        Button(reference.kind == .tag ? "Filter to This Tag" : "Filter to This Branch") { model.filterTo(reference) }
        Button(model.filter.contains(reference) ? "Remove from Filter" : "Add to Filter") {
            model.toggleFilter([reference])
        }
    }
}
