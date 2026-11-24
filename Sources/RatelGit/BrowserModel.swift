import AppKit
import Combine
import RatelGitCore

enum WorkspaceMode: String, CaseIterable {
    case history = "History"
    case changes = "Changes"
}

@MainActor
final class BrowserModel: ObservableObject {
    private let store: ProjectStore
    private var task: Task<Void, Never>?
    private var pageTask: Task<Void, Never>?
    private var projectsTask: Task<Void, Never>?
    @Published private(set) var projects: [Project] = []
    @Published private(set) var projectPath: String?
    @Published private(set) var active: Worktree?
    @Published private(set) var references: [Reference] = []
    @Published private(set) var history = HistoryState.empty
    @Published private(set) var files: [ChangedFile] = []
    @Published private(set) var commit: String?
    @Published private(set) var detail: CommitDetail?
    @Published private(set) var commitFiles: [ChangedFile] = []
    @Published private(set) var file: ChangedFile?
    @Published private(set) var patch = ""
    @Published private(set) var error: String?
    @Published private(set) var loading = false
    @Published private(set) var loadingPage = false
    @Published private(set) var mutation: String?
    @Published private(set) var tracking: Tracking?
    @Published private(set) var operation: RepositoryOperation?
    @Published private(set) var drafts: [String: String] = [:]
    @Published private(set) var filters: [String: HistoryFilter] = [:]
    @Published private(set) var ignoreWhitespace = false
    @Published private(set) var mode = WorkspaceMode.history
    @Published var confirmation: Confirmation?
    @Published var prompt: Prompt?
    @Published var promptText = ""
    @Published var switcherVisible = false

    init(store: ProjectStore = .standard) {
        self.store = store
        projects = store.load().map { Project(path: $0, worktrees: [], state: .loading) }
        loadProjects()
    }

    var graph: [GraphLine] { history.lines }
    var project: Project? { projects.first { $0.path == projectPath } }
    var filter: HistoryFilter { projectPath.flatMap { filters[$0] } ?? .none }

    var draft: String {
        get { active.flatMap { drafts[$0.path] } ?? "" }
        set {
            guard let active else { return }
            drafts = drafts.merging([active.path: newValue]) { _, value in value }
        }
    }

    // MARK: Projects

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
            guard let main = items.first?.path else {
                error = "This folder has no Git worktree."
                return
            }
            // Paths of this repository's worktrees saved by older versions collapse into one project.
            let merged = projects.filter { candidate in candidate.path == main || !items.contains { $0.path == candidate.path } }
            let fresh = Project(path: main, worktrees: items, state: .ready)
            projects = merged.contains { $0.path == main } ? merged.map { $0.path == main ? fresh : $0 } : merged + [fresh]
            store.save(projects.map(\.path))
            if let match = items.first(where: { !$0.unavailable && $0.path == root }) ?? items.first(where: { !$0.unavailable }) {
                select(match)
            } else {
                active = nil
                projectPath = main
                clearWorkspace()
                error = "This repository has no available working tree."
            }
        }
    }

    func removeProject(_ project: Project) {
        guard mutation == nil else { return }
        projects = projects.filter { $0.path != project.path }
        filters = filters.filter { $0.key != project.path }
        store.save(projects.map(\.path))
        guard projectPath == project.path else { return }
        task?.cancel()
        loading = false
        active = nil
        projectPath = nil
        clearWorkspace()
    }

    func selectProject(_ project: Project) {
        guard let tree = project.worktrees.first(where: { !$0.unavailable }) else { return }
        select(tree)
    }

    /// Reads every project's worktrees in the background. Missing folders show as unavailable.
    func loadProjects() {
        projectsTask?.cancel()
        let paths = projects.map(\.path)
        guard !paths.isEmpty else { return }
        projectsTask = Task {
            let resolved = await Task.detached { paths.map(Self.resolveProject) }.value
            guard !Task.isCancelled else { return }
            let lookup = Dictionary(zip(paths, resolved), uniquingKeysWith: { first, _ in first })
            let updated = projects.map { lookup[$0.path] ?? $0 }
            projects = updated.reduce(into: [Project]()) { result, item in
                if !result.contains(where: { $0.path == item.path }) { result.append(item) }
            }
            store.save(projects.map(\.path))
            if let active { projectPath = projects.first { $0.contains(active) }?.path ?? projectPath }
            if active == nil, mutation == nil, !loading,
               let first = projects.first(where: { !$0.isUnavailable && $0.worktrees.contains { !$0.unavailable } }) {
                selectProject(first)
            }
        }
    }

    nonisolated private static func resolveProject(_ path: String) -> Project {
        guard FileManager.default.fileExists(atPath: path) else {
            return Project(path: path, worktrees: [], state: .unavailable("Folder not found"))
        }
        do {
            let trees = try Git(path: path).worktrees()
            return Project(path: trees.first?.path ?? path, worktrees: trees, state: .ready)
        } catch {
            return Project(path: path, worktrees: [], state: .unavailable(error.localizedDescription))
        }
    }

    // MARK: Worktrees

    func refresh() {
        loadProjects()
        guard let active, mutation == nil else { return }
        select(active)
    }

    func move(_ offset: Int) {
        let available = (project?.worktrees ?? []).filter { !$0.unavailable }
        guard let index = available.firstIndex(where: { $0.id == active?.id }), available.count > 1 else { return }
        select(available[(index + offset + available.count) % available.count])
    }

    func select(_ worktree: Worktree) {
        guard mutation == nil, !worktree.unavailable else { return }
        active = worktree
        projectPath = projects.first { $0.contains(worktree) }?.path ?? projectPath
        clearWorkspace()
        reload()
    }

    func setMode(_ next: WorkspaceMode) {
        guard next != mode else { return }
        mode = next
        let keep = next == .history ? file?.kind == .committed : file.map { $0.kind != .committed } ?? false
        if !keep { clearPatch() }
    }

    /// Reads the selected worktree again. Only the latest request reaches the screen.
    private func reload() {
        guard let active else { return }
        let git = Git(path: active.path)
        let requested = filter
        let owner = projectPath
        perform({ try WorktreeSnapshot.load(git, filter: requested) }) { [self] snapshot in
            apply(snapshot, owner: owner)
        }
    }

    private func apply(_ snapshot: WorktreeSnapshot, owner: String?) {
        resetHistory(snapshot.history)
        (references, files, tracking, operation) = (snapshot.references, snapshot.files, snapshot.tracking, snapshot.operation)
        if let owner { filters = filters.merging([owner: snapshot.filter]) { _, value in value } }
    }

    // MARK: History

    func loadMoreHistory() {
        guard let active, !history.complete, !loadingPage, mutation == nil else { return }
        let git = Git(path: active.path)
        let state = history
        let scope = filter.scope
        loadingPage = true
        pageTask = Task {
            let result = await Task.detached {
                Result { state.appending(try git.history(scope, skip: state.lines.count), pageSize: Git.historyPageSize) }
            }.value
            // A newer listing replaced this one while the page was loading.
            guard !Task.isCancelled, history.token == state.token else { return }
            loadingPage = false
            switch result {
            case .success(let next): history = next
            case .failure(let failure): error = "Loading more history failed. \(failure.localizedDescription)"
            }
        }
    }

    func toggleFilter(_ refs: [Reference]) { setFilter(filter.toggling(refs)) }
    func clearFilter() { setFilter(.none) }
    func removeFromFilter(_ ref: String) { setFilter(filter.removing(ref)) }
    func toggleCurrentBranchOnly() { setFilter(filter.toggledCurrentBranch()) }

    func filterTo(_ ref: Reference) {
        setMode(.history)
        setFilter(HistoryFilter(refs: [ref.id]))
    }

    private func setFilter(_ next: HistoryFilter) {
        guard let projectPath, active != nil, mutation == nil, next != filter else { return }
        filters = filters.merging([projectPath: next]) { _, value in value }
        resetHistory(.empty)
        clearCommit()
        reload()
    }

    // MARK: Selection

    func selectCommit(_ hash: String?) {
        guard let active, mutation == nil else { return }
        clearCommit()
        guard let hash else { return }
        commit = hash
        let git = Git(path: active.path)
        let whitespace = ignoreWhitespace
        perform({
            let files = try git.commitFiles(hash)
            let first = files.first
            return CommitSelection(detail: try git.commitDetail(hash), files: files, file: first,
                                   patch: try first.map { try git.diff($0, commit: hash, ignoreWhitespace: whitespace) } ?? "")
        }) { [self] selection in
            (detail, commitFiles, file, patch) = (selection.detail, selection.files, selection.file, selection.patch)
        }
    }

    /// Shows the commit a branch, tag or stash points at.
    func reveal(_ ref: Reference) {
        guard let target = ref.target, mutation == nil else { return }
        setMode(.history)
        selectCommit(target)
    }

    func selectFile(_ selected: ChangedFile) {
        guard let active, mutation == nil else { return }
        file = selected
        patch = ""
        let git = Git(path: active.path)
        let revision = selected.kind == .committed ? commit : nil
        let whitespace = ignoreWhitespace
        perform({ try git.diff(selected, commit: revision, ignoreWhitespace: whitespace) }) { [self] result in
            patch = result
        }
    }

    func setIgnoreWhitespace(_ value: Bool) {
        guard value != ignoreWhitespace else { return }
        ignoreWhitespace = value
        if let file { selectFile(file) }
    }

    func dismissError() { error = nil }

    // MARK: Mutations

    func execute(_ action: GitAction) {
        guard let active, mutation == nil, !loading else { return }
        let git = Git(path: active.path)
        let label = action.label
        let requested = filter
        let owner = projectPath
        let selected = file
        mutation = label
        error = nil
        Task {
            let result = await Task.detached {
                let operation = Result { try git.execute(action) }
                let snapshot = Result { (try git.worktrees(), try WorktreeSnapshot.load(git, filter: requested)) }
                return (operation, snapshot)
            }.value
            mutation = nil
            finish(action, label: label, worktree: active, owner: owner, selected: selected,
                   operation: result.0, snapshot: result.1)
        }
    }

    private func finish(_ action: GitAction, label: String, worktree: Worktree, owner: String?, selected: ChangedFile?,
                        operation: Result<Void, Error>, snapshot: Result<([Worktree], WorktreeSnapshot), Error>) {
        switch operation {
        case .success:
            succeeded(action, worktree: worktree, owner: owner)
        case .failure(let failure):
            if case .deleteBranch(let ref, false) = action, failure.localizedDescription.contains("not fully merged") {
                confirmation = .forceDeleteBranch(ref)
            } else {
                error = "\(label) failed. \(failure.localizedDescription)"
            }
        }
        switch snapshot {
        case .success(let (trees, state)):
            updateWorktrees(trees, owner: owner)
            self.active = trees.first { $0.path == worktree.path }
            clearCommit()
            clearPatch()
            apply(state, owner: owner)
            if let added = addedWorktree(action, in: trees) {
                select(added)
            } else if let selected, mode == .changes {
                reselect(selected)
            }
        case .failure(let failure):
            clearWorkspace()
            if error == nil { error = "Refresh failed. \(failure.localizedDescription)" }
        }
    }

    private func succeeded(_ action: GitAction, worktree: Worktree, owner: String?) {
        switch action {
        case .commit:
            drafts = drafts.filter { $0.key != worktree.path }
        case .renameBranch(let ref, let name):
            guard let owner, let current = filters[owner] else { return }
            filters = filters.merging([owner: current.renaming(ref.id, to: "refs/heads/" + name)]) { _, value in value }
        default:
            break
        }
    }

    private func addedWorktree(_ action: GitAction, in trees: [Worktree]) -> Worktree? {
        guard case .addWorktree(_, let location) = action else { return nil }
        let wanted = URL(fileURLWithPath: location).resolvingSymlinksInPath().path
        return trees.first { URL(fileURLWithPath: $0.path).resolvingSymlinksInPath().path == wanted && !$0.unavailable }
    }

    /// Keeps the same path selected after staging, preferring the side the user was looking at.
    private func reselect(_ previous: ChangedFile) {
        let candidates = files.filter { $0.path == previous.path }
        guard let next = candidates.first(where: { $0.kind == previous.kind }) ?? candidates.first else { return }
        selectFile(next)
    }

    private func updateWorktrees(_ trees: [Worktree], owner: String?) {
        guard let owner else { return }
        projects = projects.map { $0.path == owner ? $0.replacing(worktrees: trees) : $0 }
    }

    func submit(_ current: Prompt) {
        let text = promptText
        prompt = nil
        switch current.kind {
        case .createBranch: execute(.createBranch(text))
        case .stash: execute(.stash(text))
        case .rename(let ref): execute(.renameBranch(ref, to: text))
        case .addWorktree(let ref): addWorktree(ref, at: text)
        }
    }

    func ask(_ next: Prompt) {
        promptText = next.initial
        prompt = next
    }

    func run(_ current: Confirmation) {
        confirmation = nil
        execute(current.action)
    }

    private func addWorktree(_ ref: Reference, at text: String) {
        let location = (text.trimmingCharacters(in: .whitespacesAndNewlines) as NSString).expandingTildeInPath
        guard FileManager.default.fileExists(atPath: location) else {
            execute(.addWorktree(ref, path: location))
            return
        }
        Task {
            // Let the prompt finish dismissing before the confirmation is presented.
            try? await Task.sleep(for: .milliseconds(350))
            confirmation = .existingFolder(ref, path: location)
        }
    }

    // MARK: State helpers

    private func resetHistory(_ next: HistoryState) {
        pageTask?.cancel()
        loadingPage = false
        history = next
    }

    private func clearWorkspace() {
        tracking = nil
        operation = nil
        references = []
        files = []
        resetHistory(.empty)
        clearCommit()
        clearPatch()
    }

    private func clearCommit() {
        commit = nil
        detail = nil
        commitFiles = []
        if file?.kind == .committed { clearPatch() }
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
