//! Removing a worktree never loses something the user did not see and agree to.

mod common;

use std::path::{Path, PathBuf};

use common::*;
use ratelgit_lib::error::ErrorKind;
use ratelgit_lib::git::{Git, RemoveOptions, Seen, WorktreeBranch};
use ratelgit_lib::projects::Registry;
use ratelgit_lib::store::Store;

fn options(force: bool, branch: bool, unmerged: bool, remote: bool) -> RemoveOptions {
    RemoveOptions {
        force,
        delete_branch: branch,
        allow_unmerged: unmerged,
        delete_remote: remote,
        seen: Seen::default(),
    }
}

fn existing(reference: &str) -> WorktreeBranch {
    WorktreeBranch::Existing {
        reference: reference.into(),
    }
}

fn add(repo: &Path, at: &Path, branch: WorktreeBranch) -> PathBuf {
    Git::new(repo).create_worktree(&branch, at).unwrap();
    at.to_path_buf()
}

#[test]
fn commits_only_on_the_remote_branch_count_when_it_is_deleted_too() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    git(&repo, &["switch", "-q", "-c", "topic", "main"]);
    git(
        &repo,
        &["commit", "-q", "--allow-empty", "-m", "Pushed, not merged"],
    );
    git(&repo, &["push", "-q", "-u", "origin", "topic"]);
    git(&repo, &["switch", "-q", "main"]);
    let path = add(
        &repo,
        &sandbox.root.join("sample-topic"),
        existing("refs/heads/topic"),
    );
    let client = Git::new(&repo);
    let preview = client.removal_preview(&git_path(&path)).unwrap();
    assert_eq!(
        preview.unmerged_commits, 0,
        "the remote branch still has it"
    );
    assert_eq!(
        preview.unmerged_with_remote, 1,
        "deleting the remote branch too loses it"
    );
    assert!(preview.remote_block.is_none());
    let refused = remove_agreed(
        &client,
        &git_path(&path),
        &options(false, true, false, true),
    );
    assert_eq!(refused.unwrap_err().kind, ErrorKind::InvalidInput);
    assert!(path.exists() && has_ref(&client, "refs/remotes/origin/topic"));
    remove_agreed(&client, &git_path(&path), &options(false, true, true, true)).unwrap();
    assert!(!has_ref(&client, "refs/heads/topic"));
}

#[test]
fn an_upstream_with_another_name_or_the_remote_default_is_never_deleted() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    // `hotfix` tracks origin/main: deleting "its remote branch" would delete main.
    let fix = sandbox.root.join("sample-hotfix");
    git(
        &repo,
        &[
            "worktree",
            "add",
            "-q",
            "--track",
            "-b",
            "hotfix",
            &git_path(&fix),
            "origin/main",
        ],
    );
    let client = Git::new(&repo);
    let preview = client.removal_preview(&git_path(&fix)).unwrap();
    assert_eq!(preview.upstream.as_ref().unwrap().name, "main");
    assert!(preview
        .remote_block
        .as_deref()
        .unwrap()
        .contains("origin/main"));
    let refused = remove_agreed(&client, &git_path(&fix), &options(false, true, true, true));
    assert_eq!(refused.unwrap_err().kind, ErrorKind::InvalidInput);
    assert!(fix.exists() && has_ref(&client, "refs/remotes/origin/main"));

    // Same name, but the remote's default branch.
    git(&repo, &["push", "-q", "origin", "main:develop"]);
    git(&repo, &["fetch", "-q", "origin"]);
    git(&repo, &["remote", "set-head", "origin", "develop"]);
    let develop = sandbox.root.join("sample-develop");
    git(
        &repo,
        &[
            "worktree",
            "add",
            "-q",
            "--track",
            "-b",
            "develop",
            &git_path(&develop),
            "origin/develop",
        ],
    );
    let preview = client.removal_preview(&git_path(&develop)).unwrap();
    assert!(
        preview.remote_block.is_some(),
        "origin/develop is the remote's default branch"
    );
}

#[test]
fn ignored_files_are_counted_and_need_consent() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    put(&repo, ".gitignore", ".env\nnode_modules/\n");
    commit_all(&repo, "Ignore local files");
    let path = add(
        &repo,
        &sandbox.root.join("sample-side"),
        existing("refs/heads/side"),
    );
    put(&path, ".gitignore", ".env\nnode_modules/\n");
    put(&path, ".env", "SECRET=1\n");
    put(&path, "node_modules/a/index.js", "x\n");
    put(&path, "node_modules/b/index.js", "x\n");
    let client = Git::new(&repo);
    let preview = client.removal_preview(&git_path(&path)).unwrap();
    assert_eq!(preview.ignored, 2, "node_modules counts once");
    assert!(preview.ignored_examples.contains(&".env".to_string()));
    let refused = remove_agreed(
        &client,
        &git_path(&path),
        &options(false, false, false, false),
    );
    assert_eq!(refused.unwrap_err().kind, ErrorKind::InvalidInput);
    assert!(path.join(".env").exists());
    remove_agreed(
        &client,
        &git_path(&path),
        &options(true, false, false, false),
    )
    .unwrap();
    assert!(!path.exists());
}

#[test]
fn a_detached_worktrees_own_commits_need_consent() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let path = sandbox.root.join("sample-detached");
    git(
        &repo,
        &[
            "worktree",
            "add",
            "-q",
            "--detach",
            &git_path(&path),
            "main",
        ],
    );
    git(&path, &["commit", "-q", "--allow-empty", "-m", "Only here"]);
    let client = Git::new(&repo);
    assert_eq!(
        client
            .removal_preview(&git_path(&path))
            .unwrap()
            .unmerged_commits,
        1
    );
    let refused = remove_agreed(
        &client,
        &git_path(&path),
        &options(false, false, false, false),
    );
    assert_eq!(refused.unwrap_err().kind, ErrorKind::InvalidInput);
    remove_agreed(
        &client,
        &git_path(&path),
        &options(false, false, true, false),
    )
    .unwrap();
    assert!(!path.exists());
}

#[test]
fn a_worktree_with_submodules_is_flagged_and_removed_with_consent() {
    let sandbox = sandbox();
    let module = sandbox.root.join("module");
    init(&module);
    put(&module, "m.txt", "m\n");
    commit_all(&module, "Module");
    let repo = sample_repository(&sandbox.root, "sample");
    let path = add(
        &repo,
        &sandbox.root.join("sample-side"),
        existing("refs/heads/side"),
    );
    git(
        &path,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            &git_path(&module),
            "vendor/module",
        ],
    );
    git(&path, &["commit", "-q", "-m", "Add submodule"]);
    git(&path, &["push", "-q", "origin", "side"]);
    let client = Git::new(&repo);
    let preview = client.removal_preview(&git_path(&path)).unwrap();
    assert!(preview.submodules);
    assert!(remove_agreed(
        &client,
        &git_path(&path),
        &options(false, false, false, false)
    )
    .is_err());
    remove_agreed(
        &client,
        &git_path(&path),
        &options(true, false, false, false),
    )
    .unwrap();
    assert!(!path.exists());
}

#[test]
fn cleaning_up_one_missing_worktree_leaves_the_others() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let first = add(
        &repo,
        &sandbox.root.join("sample-side"),
        existing("refs/heads/side"),
    );
    let second = add(
        &repo,
        &sandbox.root.join("sample-login"),
        existing("refs/heads/fix/login"),
    );
    std::fs::remove_dir_all(&first).unwrap();
    std::fs::remove_dir_all(&second).unwrap();
    let client = Git::new(&repo);
    remove_agreed(
        &client,
        &git_path(&first),
        &options(false, false, false, false),
    )
    .unwrap();
    let paths: Vec<_> = client
        .worktrees()
        .unwrap()
        .into_iter()
        .map(|t| t.path)
        .collect();
    assert!(!paths.contains(&git_path(&first)));
    assert!(
        paths.contains(&git_path(&second)),
        "a drive that is only unplugged keeps its record"
    );
}

#[test]
fn the_configured_default_branch_is_protected_without_origin_head() {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    init(&root);
    git(&root, &["config", "init.defaultBranch", "trunk"]);
    put(&root, "a.txt", "a\n");
    commit_all(&root, "Base");
    git(&root, &["branch", "trunk"]);
    let path = add(
        &root,
        &sandbox.root.join("trunk"),
        existing("refs/heads/trunk"),
    );
    let preview = Git::new(&root).removal_preview(&git_path(&path)).unwrap();
    assert!(preview.branch_block.unwrap().contains("default branch"));
}

#[test]
fn bare_repositories_with_linked_worktrees_add_and_remove() {
    let sandbox = sandbox();
    let source = sample_repository(&sandbox.root, "sample");
    let bare = sandbox.root.join("bare.git");
    git(
        &sandbox.root,
        &[
            "clone",
            "-q",
            "--bare",
            &git_path(&source),
            &git_path(&bare),
        ],
    );
    let one = sandbox.root.join("one");
    let two = sandbox.root.join("two");
    git(&bare, &["worktree", "add", "-q", &git_path(&one), "main"]);
    git(&bare, &["worktree", "add", "-q", &git_path(&two), "side"]);
    let registry = Registry::new(Store::new(&sandbox.root.join("config")));
    registry.add_folder(&git_path(&one)).unwrap();

    let three = registry
        .worktree_folder(&git_path(&one), None, "three")
        .unwrap();
    Git::new(&one)
        .create_worktree(&existing("refs/heads/fix/login"), &three)
        .unwrap();
    let two_path = git_path(&two);
    let base = options(false, false, false, false);
    let preview = Git::new(&one).removal_preview(&two_path).unwrap();
    let agreed = RemoveOptions {
        seen: Seen::of(&preview, &base),
        ..base
    };
    let result = registry
        .remove_worktree(&git_path(&one), &two_path, &agreed)
        .unwrap();
    assert!(result.problem.is_none());
    assert!(!two.exists());
    assert!(registry.resolve_worktree(&git_path(&one)).is_ok());
}

#[test]
fn a_tracked_change_after_the_preview_is_not_removed_with_the_old_consent() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    put(&repo, ".gitignore", "build/\n");
    commit_all(&repo, "Ignore build output");
    git(&repo, &["switch", "-q", "side"]);
    git(&repo, &["merge", "-q", "--ff-only", "main"]);
    git(&repo, &["switch", "-q", "main"]);
    let path = add(
        &repo,
        &sandbox.root.join("sample-side"),
        existing("refs/heads/side"),
    );
    put(&path, "build/out.txt", "generated\n");
    let client = Git::new(&repo);
    let preview = client.removal_preview(&git_path(&path)).unwrap();
    assert_eq!((preview.ignored, preview.changes), (1, 0));
    // The user agrees to lose the ignored build folder...
    let base = options(true, false, false, false);
    let consent = RemoveOptions {
        seen: Seen::of(&preview, &base),
        ..base
    };
    // ...then edits a tracked file before confirming.
    put(&path, "side.txt", "important edit\n");
    let refused = client
        .remove_worktree(&git_path(&path), &consent)
        .unwrap_err();
    assert_eq!(refused.kind, ErrorKind::Stale, "{}", refused.message);
    assert_eq!(read(&path, "side.txt"), "important edit\n");
}

#[test]
fn a_new_commit_after_the_preview_is_not_deleted_with_the_old_consent() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let path = add(
        &repo,
        &sandbox.root.join("sample-work"),
        WorktreeBranch::New {
            name: "work".into(),
            start_point: "HEAD".into(),
        },
    );
    git(&path, &["commit", "-q", "--allow-empty", "-m", "First"]);
    let client = Git::new(&repo);
    let preview = client.removal_preview(&git_path(&path)).unwrap();
    assert_eq!(preview.unmerged_commits, 1);
    let base = options(false, true, true, false);
    let consent = RemoveOptions {
        seen: Seen::of(&preview, &base),
        ..base
    };
    git(&path, &["commit", "-q", "--allow-empty", "-m", "Second"]);
    let refused = client
        .remove_worktree(&git_path(&path), &consent)
        .unwrap_err();
    assert_eq!(refused.kind, ErrorKind::Stale);
    assert!(path.exists() && has_ref(&client, "refs/heads/work"));

    // With the preview of the current state the same request goes through.
    let preview = client.removal_preview(&git_path(&path)).unwrap();
    let fresh = RemoveOptions {
        seen: Seen::of(&preview, &base),
        ..base
    };
    client.remove_worktree(&git_path(&path), &fresh).unwrap();
    assert!(!path.exists());
}

#[test]
fn a_remote_branch_that_moved_since_the_last_fetch_is_kept() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    git(&repo, &["switch", "-q", "-c", "shared", "main"]);
    git(&repo, &["push", "-q", "-u", "origin", "shared"]);
    git(&repo, &["switch", "-q", "main"]);
    let path = add(
        &repo,
        &sandbox.root.join("sample-shared"),
        existing("refs/heads/shared"),
    );
    // Someone else pushes to the branch; this clone has not fetched.
    let remote = sandbox.root.join("sample-remote.git");
    let other = sandbox.root.join("other");
    git(
        &sandbox.root,
        &[
            "clone",
            "-q",
            "-b",
            "shared",
            &git_path(&remote),
            &git_path(&other),
        ],
    );
    configure_identity(&other);
    git(
        &other,
        &["commit", "-q", "--allow-empty", "-m", "Their work"],
    );
    git(&other, &["push", "-q"]);

    let client = Git::new(&repo);
    let result =
        remove_agreed(&client, &git_path(&path), &options(false, true, true, true)).unwrap();
    assert_eq!(
        (result.branch_deleted, result.remote_deleted),
        (Some(true), Some(false))
    );
    assert!(result
        .problem
        .unwrap()
        .contains("changed since the last fetch"));
    let tip = git(&remote, &["log", "-1", "--format=%s", "shared"]);
    assert_eq!(
        tip.trim(),
        "Their work",
        "the remote branch and their commit stay"
    );
}

#[test]
fn ignored_files_inside_an_ignored_folder_are_counted_once() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let path = add(
        &repo,
        &sandbox.root.join("sample-side"),
        existing("refs/heads/side"),
    );
    let exclude = git(&path, &["rev-parse", "--git-path", "info/exclude"]);
    let exclude = path.join(exclude.trim());
    std::fs::create_dir_all(exclude.parent().unwrap()).unwrap();
    std::fs::write(&exclude, "cache/\n*.log\n").unwrap();
    put(&path, "cache/a.bin", "a\n");
    put(&path, "cache/b.bin", "b\n");
    put(&path, "logs/run.log", "x\n");
    let preview = Git::new(&repo).removal_preview(&git_path(&path)).unwrap();
    assert_eq!(preview.ignored, 2, "{:?}", preview.ignored_examples);
}
