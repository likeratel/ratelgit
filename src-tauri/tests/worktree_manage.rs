//! Adding and removing worktrees from the app.

mod common;

use std::path::{Path, PathBuf};

use common::*;
use ratelgit_lib::error::ErrorKind;
use ratelgit_lib::git::{Git, RemoveOptions, Seen, WorktreeBranch};

fn new_branch(name: &str, start: &str) -> WorktreeBranch {
    WorktreeBranch::New {
        name: name.into(),
        start_point: start.into(),
    }
}

fn tree_branch(client: &Git, path: &Path) -> Option<String> {
    client
        .worktrees()
        .unwrap()
        .into_iter()
        .find(|t| t.path == git_path(path))
        .and_then(|t| t.branch)
}

fn keep() -> RemoveOptions {
    RemoveOptions {
        force: false,
        delete_branch: false,
        allow_unmerged: false,
        delete_remote: false,
        seen: Seen::default(),
    }
}

#[test]
fn worktrees_are_added_on_new_existing_and_remote_branches() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let client = Git::new(&repo);

    let fresh = sandbox.root.join("sample-topic");
    client
        .create_worktree(&new_branch("topic/new", "refs/remotes/origin/main"), &fresh)
        .unwrap();
    assert_eq!(tree_branch(&client, &fresh).as_deref(), Some("topic/new"));
    let start = git(&repo, &["rev-parse", "refs/remotes/origin/main"]);
    assert_eq!(
        git(&fresh, &["rev-parse", "HEAD"]),
        start,
        "starts at the chosen point"
    );
    assert!(
        Git::new(&fresh).tracking().unwrap().is_none(),
        "a new branch does not track its start point"
    );

    let existing = sandbox.root.join("sample-login");
    client
        .create_worktree(
            &WorktreeBranch::Existing {
                reference: "refs/heads/fix/login".into(),
            },
            &existing,
        )
        .unwrap();
    assert_eq!(
        tree_branch(&client, &existing).as_deref(),
        Some("fix/login")
    );

    git(&repo, &["branch", "-q", "-D", "feature/x/y"]);
    let remote = sandbox.root.join("sample-nested");
    client
        .create_worktree(
            &WorktreeBranch::Remote {
                reference: "refs/remotes/origin/feature/x/y".into(),
            },
            &remote,
        )
        .unwrap();
    assert_eq!(
        tree_branch(&client, &remote).as_deref(),
        Some("feature/x/y")
    );
    assert_eq!(
        Git::new(&remote).tracking().unwrap().unwrap().remote,
        "origin"
    );
}

#[test]
fn adding_refuses_taken_folders_and_branches() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let client = Git::new(&repo);
    let taken = sandbox.root.join("taken");
    put(&taken, "file.txt", "x\n");
    assert!(
        client
            .create_worktree(&new_branch("fresh", "HEAD"), &taken)
            .is_err(),
        "non-empty folder"
    );
    let folder = sandbox.root.join("free");
    let existing = client.create_worktree(&new_branch("side", "HEAD"), &folder);
    assert!(existing.is_err(), "the branch exists");
    let invalid = client.create_worktree(&new_branch("bad..name", "HEAD"), &folder);
    assert_eq!(invalid.unwrap_err().kind, ErrorKind::InvalidInput);
    let busy = client.create_worktree(
        &WorktreeBranch::Existing {
            reference: "refs/heads/main".into(),
        },
        &folder,
    );
    assert!(busy.is_err(), "main is checked out in the main worktree");
    assert!(!folder.exists(), "nothing was created");
    let plan = client.check_new_branch("side").unwrap_err();
    assert!(plan.message.contains("already exists"), "{}", plan.message);
    assert!(client.check_new_branch("brand/new").is_ok());
}

fn linked(sandbox: &Sandbox, repo: &Path, name: &str, branch: WorktreeBranch) -> PathBuf {
    let path = sandbox.root.join(name);
    Git::new(repo).create_worktree(&branch, &path).unwrap();
    path
}

#[test]
fn a_clean_worktree_and_its_merged_branch_are_removed() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let path = linked(
        &sandbox,
        &repo,
        "sample-side",
        WorktreeBranch::Existing {
            reference: "refs/heads/side".into(),
        },
    );
    let client = Git::new(&repo);
    let preview = client.removal_preview(&git_path(&path)).unwrap();
    assert_eq!(preview.branch.as_deref(), Some("side"));
    assert_eq!(
        (preview.changes, preview.untracked, preview.unmerged_commits),
        (0, 0, 0)
    );
    assert!(preview.branch_block.is_none());
    let options = RemoveOptions {
        delete_branch: true,
        ..keep()
    };
    let result = remove_agreed(&client, &git_path(&path), &options).unwrap();
    assert_eq!(result.branch_deleted, Some(true));
    assert!(result.problem.is_none());
    assert!(!path.exists());
    assert!(!has_ref(&client, "refs/heads/side"));
}

#[test]
fn changes_and_unmerged_commits_need_explicit_consent() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let path = linked(&sandbox, &repo, "sample-work", new_branch("work", "HEAD"));
    put(&path, "README.md", "edited\n");
    put(&path, "scratch.txt", "new\n");
    put(&path, "more.txt", "new\n");
    git(&path, &["add", "more.txt"]);
    git(&path, &["commit", "-q", "-m", "Unpushed work"]);
    let client = Git::new(&repo);
    let preview = client.removal_preview(&git_path(&path)).unwrap();
    assert_eq!(preview.changes, 1);
    assert_eq!(preview.untracked, 1);
    assert_eq!(preview.unmerged_commits, 1);

    let dirty = remove_agreed(&client, &git_path(&path), &keep()).unwrap_err();
    assert_eq!(dirty.kind, ErrorKind::InvalidInput);
    assert!(path.exists(), "nothing removed without force");
    let unmerged = RemoveOptions {
        force: true,
        delete_branch: true,
        ..keep()
    };
    assert!(
        remove_agreed(&client, &git_path(&path), &unmerged).is_err(),
        "unmerged commits need consent"
    );
    assert!(path.exists() && has_ref(&client, "refs/heads/work"));

    let everything = RemoveOptions {
        force: true,
        delete_branch: true,
        allow_unmerged: true,
        ..keep()
    };
    let result = remove_agreed(&client, &git_path(&path), &everything).unwrap();
    assert_eq!(result.branch_deleted, Some(true));
    assert!(!path.exists() && !has_ref(&client, "refs/heads/work"));
}

#[test]
fn the_remote_branch_is_deleted_only_when_asked_and_failures_are_reported() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    git(&repo, &["switch", "-q", "-c", "shared", "main"]);
    git(&repo, &["push", "-q", "-u", "origin", "shared"]);
    git(&repo, &["switch", "-q", "main"]);
    let path = linked(
        &sandbox,
        &repo,
        "sample-shared",
        WorktreeBranch::Existing {
            reference: "refs/heads/shared".into(),
        },
    );
    let client = Git::new(&repo);
    let preview = client.removal_preview(&git_path(&path)).unwrap();
    let upstream = preview.upstream.clone().unwrap();
    assert_eq!(
        (upstream.remote.as_str(), upstream.name.as_str()),
        ("origin", "shared")
    );
    let remote = sandbox.root.join("sample-remote.git");
    let options = RemoveOptions {
        delete_branch: true,
        delete_remote: true,
        ..keep()
    };
    let result = remove_agreed(&client, &git_path(&path), &options).unwrap();
    assert_eq!(
        (result.branch_deleted, result.remote_deleted),
        (Some(true), Some(true))
    );
    assert!(git(&remote, &["branch", "--list", "shared"])
        .trim()
        .is_empty());

    // A remote that cannot be reached: the worktree and local branch go, the report says so.
    git(&repo, &["switch", "-q", "-c", "lonely", "main"]);
    git(&repo, &["push", "-q", "-u", "origin", "lonely"]);
    git(&repo, &["switch", "-q", "main"]);
    let path = linked(
        &sandbox,
        &repo,
        "sample-lonely",
        WorktreeBranch::Existing {
            reference: "refs/heads/lonely".into(),
        },
    );
    git(
        &repo,
        &[
            "remote",
            "set-url",
            "origin",
            &git_path(&sandbox.root.join("gone.git")),
        ],
    );
    let result = remove_agreed(&client, &git_path(&path), &options).unwrap();
    assert!(!path.exists());
    assert_eq!(
        (result.branch_deleted, result.remote_deleted),
        (Some(true), Some(false))
    );
    let problem = result.problem.unwrap();
    assert!(problem.contains("origin/lonely"), "{problem}");
}

#[test]
fn the_main_worktree_unknown_paths_and_the_default_branch_are_protected() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let client = Git::new(&repo);
    let main = remove_agreed(&client, &git_path(&repo), &keep()).unwrap_err();
    assert_eq!(main.kind, ErrorKind::InvalidInput);
    assert!(client.removal_preview(&git_path(&repo)).unwrap().is_main);
    let stranger = sandbox.root.join("elsewhere");
    std::fs::create_dir_all(&stranger).unwrap();
    let unknown = remove_agreed(&client, &git_path(&stranger), &keep()).unwrap_err();
    assert_eq!(unknown.kind, ErrorKind::NotFound);
    assert!(stranger.exists());

    // A linked worktree that has main checked out cannot drop the default branch.
    git(&repo, &["switch", "-q", "--detach"]);
    let path = linked(
        &sandbox,
        &repo,
        "sample-main",
        WorktreeBranch::Existing {
            reference: "refs/heads/main".into(),
        },
    );
    let preview = client.removal_preview(&git_path(&path)).unwrap();
    assert!(preview.branch_block.unwrap().contains("default branch"));
    let refused = remove_agreed(
        &client,
        &git_path(&path),
        &RemoveOptions {
            delete_branch: true,
            ..keep()
        },
    );
    assert_eq!(refused.unwrap_err().kind, ErrorKind::InvalidInput);
    assert!(path.exists());
}

#[test]
fn a_missing_worktree_folder_is_pruned() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let path = linked(
        &sandbox,
        &repo,
        "sample-gone",
        WorktreeBranch::Existing {
            reference: "refs/heads/side".into(),
        },
    );
    std::fs::remove_dir_all(&path).unwrap();
    let client = Git::new(&repo);
    let preview = client.removal_preview(&git_path(&path)).unwrap();
    assert!(preview.prunable);
    remove_agreed(&client, &git_path(&path), &keep()).unwrap();
    assert!(client
        .worktrees()
        .unwrap()
        .iter()
        .all(|t| t.path != git_path(&path)));
    assert!(
        has_ref(&client, "refs/heads/side"),
        "pruning keeps the branch"
    );
}

#[test]
fn locked_worktrees_and_stopped_merges_need_force() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let path = linked(
        &sandbox,
        &repo,
        "sample-locked",
        WorktreeBranch::Existing {
            reference: "refs/heads/side".into(),
        },
    );
    git(
        &repo,
        &[
            "worktree",
            "lock",
            "--reason",
            "on a USB disk",
            &git_path(&path),
        ],
    );
    let client = Git::new(&repo);
    let preview = client.removal_preview(&git_path(&path)).unwrap();
    assert_eq!(preview.locked.as_deref(), Some("on a USB disk"));
    assert!(remove_agreed(&client, &git_path(&path), &keep()).is_err());
    remove_agreed(
        &client,
        &git_path(&path),
        &RemoveOptions {
            force: true,
            ..keep()
        },
    )
    .unwrap();
    assert!(!path.exists());
}
