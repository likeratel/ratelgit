import Foundation
import RatelGitCore

/// Storage the project list is persisted to; `UserDefaults` in the app, an in-memory store in tests.
protocol ProjectDefaults: AnyObject {
    func stringArray(forKey key: String) -> [String]?
    func set(_ value: Any?, forKey key: String)
}

extension UserDefaults: ProjectDefaults {}

final class MemoryDefaults: ProjectDefaults {
    private var values: [String: [String]]
    init(_ values: [String: [String]] = [:]) { self.values = values }
    func stringArray(forKey key: String) -> [String]? { values[key] }
    func set(_ value: Any?, forKey key: String) { values[key] = value as? [String] }
}

struct ProjectStore {
    static let key = "projects"
    /// Earlier versions kept a most-recent list of opened folders under this key.
    static let legacyKey = "recentRepositories"
    let defaults: ProjectDefaults

    static var standard: ProjectStore { ProjectStore(defaults: UserDefaults.standard) }

    func load() -> [String] {
        if let paths = defaults.stringArray(forKey: Self.key) { return Self.unique(paths) }
        let migrated = Self.unique(defaults.stringArray(forKey: Self.legacyKey) ?? [])
        if !migrated.isEmpty { save(migrated) }
        return migrated
    }

    func save(_ paths: [String]) {
        defaults.set(Self.unique(paths), forKey: Self.key)
    }

    private static func unique(_ paths: [String]) -> [String] {
        paths.reduce(into: [String]()) { result, path in
            if !path.isEmpty, !result.contains(path) { result.append(path) }
        }
    }
}

struct Project: Identifiable, Hashable {
    enum State: Hashable {
        case loading
        case ready
        case unavailable(String)
    }

    /// Path of the repository's main worktree, or the stored path until it has been resolved.
    let path: String
    let worktrees: [Worktree]
    let state: State
    var id: String { path }
    var name: String { URL(fileURLWithPath: path).lastPathComponent }
    var isUnavailable: Bool { if case .unavailable = state { return true } else { return false } }

    func replacing(worktrees: [Worktree]) -> Project {
        Project(path: path, worktrees: worktrees, state: .ready)
    }

    func contains(_ worktree: Worktree) -> Bool { worktrees.contains { $0.path == worktree.path } }
}
