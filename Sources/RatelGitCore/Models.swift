import Foundation

public struct Worktree: Identifiable, Hashable, Sendable {
    public let path: String
    public let branch: String
    public let unavailable: Bool
    public let changes: Int?
    /// Commits ahead of and behind the upstream; nil when the branch has no usable upstream.
    public let ahead: Int?
    public let behind: Int?
    public var id: String { path }
    public var name: String { URL(fileURLWithPath: path).lastPathComponent }

    public init(path: String, branch: String, unavailable: Bool, changes: Int?, ahead: Int? = nil, behind: Int? = nil) {
        self.path = path
        self.branch = branch
        self.unavailable = unavailable
        self.changes = changes
        self.ahead = ahead
        self.behind = behind
    }
}

public enum ReferenceKind: String, CaseIterable, Sendable {
    case local = "Local branches"
    case remote = "Remote branches"
    case tag = "Tags"
    case stash = "Stashes"
}

public struct Reference: Identifiable, Hashable, Sendable {
    /// Full ref name such as `refs/heads/main`, or `stash@{n}` for stashes.
    public let id: String
    public let name: String
    public let kind: ReferenceKind
    /// Stash commit ID; stashes are applied by ID so a shifted index cannot pick another entry.
    public let revision: String?
    /// Commit the ref points at, peeled for annotated tags.
    public let target: String?
    /// True when this branch is checked out in the worktree the refs were read from.
    public let isHead: Bool
    /// Worktree that has this branch checked out, if any.
    public let worktreePath: String?
    public var group: String { kind.rawValue }

    public init(id: String, name: String, kind: ReferenceKind, revision: String? = nil, target: String? = nil,
                isHead: Bool = false, worktreePath: String? = nil) {
        self.id = id
        self.name = name
        self.kind = kind
        self.revision = revision
        self.target = target
        self.isHead = isHead
        self.worktreePath = worktreePath
    }
}

public struct GraphLine: Identifiable, Hashable, Sendable {
    /// Position in the whole history listing, stable across pages.
    public let id: Int
    public let hash: String?
    public let subject: String
    public let title: String
    public let shortHash: String
    public let author: String
    public let date: String
    public let labels: [String]
    public let parents: [String]

    public init(id: Int, hash: String?, subject: String, title: String, shortHash: String, author: String,
                date: String, labels: [String], parents: [String]) {
        self.id = id
        self.hash = hash
        self.subject = subject
        self.title = title
        self.shortHash = shortHash
        self.author = author
        self.date = date
        self.labels = labels
        self.parents = parents
    }

    public var isHead: Bool { labels.contains { $0 == "HEAD" || $0.hasPrefix("HEAD -> ") } }
}

public struct CommitDetail: Hashable, Sendable {
    public let hash: String
    public let parents: [String]
    public let author: String
    public let email: String
    public let date: String
    public let message: String
}

public enum ChangeKind: String, CaseIterable, Sendable {
    case staged = "Staged"
    case unstaged = "Unstaged"
    case untracked = "Untracked"
    case committed = "Commit"
}

public struct ChangedFile: Identifiable, Hashable, Sendable {
    public let path: String
    public let kind: ChangeKind
    public let status: String
    public var id: Self { self }
    public var isConflicted: Bool { status == "U" }

    public init(path: String, kind: ChangeKind, status: String) {
        self.path = path
        self.kind = kind
        self.status = status
    }
}

public enum RepositoryOperation: String, Sendable {
    case merge = "Merge"
    case rebase = "Rebase"
}

public struct Tracking: Sendable, Hashable {
    public let branch: String
    public let remote: String
    public let target: String
    public let ahead: Int
    public let behind: Int
}

public struct GitError: LocalizedError, Sendable {
    public let message: String
    public init(message: String) { self.message = message }
    public var errorDescription: String? { message }
}
