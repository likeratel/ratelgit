import Foundation
import RatelGitCore

/// A question asked before an action that cannot be undone.
struct Confirmation: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let button: String
    let action: GitAction

    static func discard(_ file: ChangedFile) -> Confirmation {
        let untracked = file.kind == .untracked
        return Confirmation(
            title: untracked ? "Delete Untracked File?" : "Discard Changes?",
            message: untracked
                ? "“\(file.path)” is not tracked by Git. It will be deleted from disk and cannot be recovered."
                : "Unstaged changes to “\(file.path)” will be lost. Staged changes are kept. This cannot be undone.",
            button: untracked ? "Delete File" : "Discard", action: .discard(file))
    }

    static func discardLines(_ file: ChangedFile, source: String, lines: Set<Int>, hunk: Bool) -> Confirmation {
        let scope = hunk ? "this hunk" : lines.count == 1 ? "1 selected line" : "\(lines.count) selected lines"
        return Confirmation(title: "Discard Changes?",
                            message: "Unstaged changes in \(scope) of “\(file.path)” will be lost. This cannot be undone.",
                            button: "Discard", action: .applyLines(file, source: source, lines: lines, .discard))
    }

    static func deleteBranch(_ ref: Reference) -> Confirmation {
        Confirmation(title: "Delete Branch “\(ref.name)”?",
                     message: "The branch is deleted only if it is merged. Its commits stay reachable from other refs.",
                     button: "Delete", action: .deleteBranch(ref, force: false))
    }

    static func forceDeleteBranch(_ ref: Reference) -> Confirmation {
        Confirmation(title: "“\(ref.name)” Is Not Fully Merged",
                     message: "Deleting it anyway can leave its commits unreachable. They may be lost when Git cleans up.",
                     button: "Force Delete", action: .deleteBranch(ref, force: true))
    }

    static func dropStash(_ ref: Reference) -> Confirmation {
        Confirmation(title: "Drop Stash?", message: "\(ref.name) will be removed from the stash list. This cannot be undone.",
                     button: "Drop", action: .dropStash(ref))
    }

    static func existingFolder(_ ref: Reference, path: String) -> Confirmation {
        Confirmation(title: "Folder Already Exists",
                     message: "“\(path)” already exists. Git adds the worktree only if the folder is empty; nothing in it is deleted.",
                     button: "Use Folder", action: .addWorktree(ref, path: path))
    }
}

/// A one-line text question, such as a branch name.
struct Prompt: Identifiable {
    enum Kind {
        case createBranch
        case stash
        case rename(Reference)
        case addWorktree(Reference)
    }

    let id = UUID()
    let kind: Kind
    let title: String
    let message: String
    let placeholder: String
    let button: String
    let initial: String

    static let createBranch = Prompt(kind: .createBranch, title: "Create and Switch to Branch",
                                     message: "Create a branch from the current worktree’s HEAD.",
                                     placeholder: "Branch name", button: "Create", initial: "")
    static let stash = Prompt(kind: .stash, title: "Stash Changes",
                              message: "Save staged, unstaged, and untracked changes from this worktree.",
                              placeholder: "Message (optional)", button: "Stash", initial: "")

    static func rename(_ ref: Reference) -> Prompt {
        Prompt(kind: .rename(ref), title: "Rename Branch “\(ref.name)”", message: "Enter the new branch name.",
               placeholder: "Branch name", button: "Rename", initial: ref.name)
    }

    static func addWorktree(_ ref: Reference, projectPath: String) -> Prompt {
        let parent = URL(fileURLWithPath: projectPath).deletingLastPathComponent()
        let folder = URL(fileURLWithPath: projectPath).lastPathComponent + "-" + ref.name.replacingOccurrences(of: "/", with: "-")
        return Prompt(kind: .addWorktree(ref), title: "Check Out “\(ref.name)” in New Worktree",
                      message: "Enter the folder for the new worktree. It must not exist yet, or be empty.",
                      placeholder: "Folder path", button: "Add Worktree", initial: parent.appendingPathComponent(folder).path)
    }
}
