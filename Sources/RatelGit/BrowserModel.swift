import AppKit
import Combine
import RatelGitCore

@MainActor
final class BrowserModel: ObservableObject {
    private var repository: Git?
    private var task: Task<Void, Never>?
    @Published private(set) var worktrees: [Worktree] = []
    @Published private(set) var references: [Reference] = []
    @Published private(set) var graph: [GraphLine] = []
    @Published private(set) var files: [ChangedFile] = []
    @Published private(set) var patch = ""
    @Published private(set) var active: Worktree?
    @Published private(set) var reference: Reference?
    @Published private(set) var commit: String?
    @Published private(set) var file: ChangedFile?
    @Published private(set) var error: String?
    @Published private(set) var loading = false
    @Published private(set) var opened = false
    @Published private(set) var mutation: String?
    @Published private(set) var tracking: Tracking?
    @Published private(set) var drafts: [String: String] = [:]
    @Published private(set) var recent = UserDefaults.standard.stringArray(forKey: "recentRepositories") ?? []

    var draft: String {
        get { active.flatMap { drafts[$0.path] } ?? "" }
        set {
            guard let active else { return }
            drafts = drafts.merging([active.path: newValue]) { _, value in value }
        }
    }

    func chooseRepository() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.message = "Choose a Git repository or worktree folder."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        open(url)
    }

    func open(_ url: URL) {
        guard url.isFileURL, mutation == nil else { return }
        let git = Git(path: url.path)
        perform({ try (git.worktrees(), try? git.worktreeRoot()) }) { [self] result in
            let (items, root) = result
            repository = git
            let location = root ?? url.path
            recent = Array(([location] + recent.filter { $0 != location }).prefix(10))
            UserDefaults.standard.set(recent, forKey: "recentRepositories")
            opened = true
            worktrees = items
            let matchingWorktree = items.first { !$0.unavailable && $0.path == root }
            if let match = matchingWorktree ?? items.first(where: { !$0.unavailable }) {
                select(match)
            } else {
                active = nil
                clearHistory()
                error = "This repository has no available working tree."
            }
        }
    }

    func refresh() {
        guard let repository else { return }
        open(URL(fileURLWithPath: active?.path ?? repository.path))
    }

    func move(_ offset: Int) {
        let available = worktrees.filter { !$0.unavailable }
        guard let index = available.firstIndex(where: { $0.id == active?.id }), available.count > 1 else { return }
        select(available[(index + offset + available.count) % available.count])
    }

    func select(_ worktree: Worktree) {
        guard mutation == nil, !worktree.unavailable else { return }
        active = worktree
        clearHistory()
        let git = Git(path: worktree.path)
        perform({ try (git.references(), git.graph(), git.workingFiles(), git.tracking()) }) { [self] result in
            (references, graph, files, tracking) = result
        }
    }

    func browse(_ ref: Reference?) {
        guard let active, mutation == nil else { return }
        reference = ref
        graph = []
        commit = nil
        files = []
        clearPatch()
        let git = Git(path: active.path)
        perform({ try (git.graph(ref: ref?.revision ?? ref?.id), git.workingFiles()) }) { [self] result in
            (graph, files) = result
        }
    }

    func selectCommit(_ hash: String?) {
        guard let active, mutation == nil else { return }
        commit = hash
        files = []
        clearPatch()
        let git = Git(path: active.path)
        perform({ try hash.map { try git.commitFiles($0) } ?? git.workingFiles() }) { [self] result in
            files = result
        }
    }

    func selectFile(_ selected: ChangedFile) {
        guard let active, mutation == nil else { return }
        file = selected
        patch = ""
        let git = Git(path: active.path)
        let revision = commit
        perform({ try git.diff(selected, commit: revision) }) { [self] result in
            patch = result
        }
    }

    func execute(_ action: GitAction) {
        guard let active, mutation == nil, !loading else { return }
        let git = Git(path: active.path)
        let label = action.label
        mutation = label
        error = nil
        Task {
            let result = await Task.detached {
                let operation = Result { try git.execute(action) }
                let snapshot = Result {
                    try (git.worktrees(), git.references(), git.graph(), git.workingFiles(), git.tracking())
                }
                return (operation, snapshot)
            }.value

            mutation = nil
            switch result.0 {
            case .success:
                if case .commit = action {
                    drafts = drafts.filter { $0.key != active.path }
                }
            case .failure(let failure):
                error = "\(label) failed. \(failure.localizedDescription)"
            }
            switch result.1 {
            case .success(let (trees, refs, lines, changes, remote)):
                self.active = trees.first { $0.path == active.path }
                worktrees = trees
                reference = nil
                commit = nil
                clearPatch()
                (references, graph, files, tracking) = (refs, lines, changes, remote)
            case .failure(let failure):
                clearHistory()
                if error == nil { error = "Refresh failed. \(failure.localizedDescription)" }
            }
        }
    }

    func dismissError() { error = nil }

    private func clearHistory() {
        tracking = nil
        reference = nil
        references = []
        graph = []
        commit = nil
        files = []
        clearPatch()
    }

    private func clearPatch() {
        file = nil
        patch = ""
    }

    private func perform<T: Sendable>(_ operation: @escaping @Sendable () throws -> T,
                                      apply: @escaping @MainActor (T) -> Void) {
        task?.cancel()
        error = nil
        loading = true
        task = Task {
            let worker = Task.detached { Result { try operation() } }
            let result = await withTaskCancellationHandler {
                await worker.value
            } onCancel: {
                worker.cancel()
            }
            guard !Task.isCancelled else { return }
            loading = false
            switch result {
            case .success(let value): apply(value)
            case .failure(let failure): error = failure.localizedDescription
            }
        }
    }
}
