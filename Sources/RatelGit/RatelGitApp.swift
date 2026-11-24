import SwiftUI
import RatelGitCore

@main
struct RatelGitApp: App {
    @StateObject private var model = BrowserModel()

    var body: some Scene {
        Window("ratelgit", id: "repository") {
            RepositoryView(model: model)
                .frame(minWidth: Layout.minimumWindow.width, minHeight: Layout.minimumWindow.height)
                .onOpenURL { model.open($0) }
        }
        .defaultSize(width: 1460, height: 850)
        .commands {
            CommandGroup(after: .newItem) {
                Button("Open Repository…", action: model.chooseRepository).keyboardShortcut("o")
                Button("Quick Open…") { model.switcherVisible = true }.keyboardShortcut("p")
                Button("Refresh Repository", action: model.refresh).keyboardShortcut("r")
                Divider()
                Button("Previous Worktree") { model.move(-1) }
                    .keyboardShortcut("[", modifiers: [.command, .option])
                Button("Next Worktree") { model.move(1) }
                    .keyboardShortcut("]", modifiers: [.command, .option])
            }
            CommandGroup(before: .sidebar) {
                Button("History") { model.setMode(.history) }.keyboardShortcut("1")
                Button("Changes") { model.setMode(.changes) }.keyboardShortcut("2")
                Button(model.filter.isCurrentBranchOnly ? "Show All Branches" : "Show Current Branch Only",
                       action: model.toggleCurrentBranchOnly)
                    .keyboardShortcut("a", modifiers: [.command, .shift])
                    .disabled(model.active == nil)
                Divider()
            }
        }
    }
}

enum Layout {
    static let minimumWindow = CGSize(width: 1050, height: 630)
    static let sidebar: (min: CGFloat, ideal: CGFloat, max: CGFloat) = (220, 260, 380)
    static let center: (min: CGFloat, ideal: CGFloat) = (380, 640)
    static let inspector: (min: CGFloat, ideal: CGFloat) = (400, 560)
    static let historyList: (min: CGFloat, ideal: CGFloat) = (170, 380)
    static let commitDetail: (min: CGFloat, ideal: CGFloat) = (230, 360)
    static let commitSummary: (min: CGFloat, ideal: CGFloat) = (320, 430)
}
