//! Repositories are not trusted: their configuration must not run programs on read commands,
//! paths from the UI must stay inside the worktree, and worktree boundaries are checked.

mod common;

use common::*;
use ratelgit_lib::error::ErrorKind;
use ratelgit_lib::git::{ChangeKind, ChangedFile, Git, OpenDecision};
use ratelgit_lib::projects::Registry;
use ratelgit_lib::store::Store;

/// A script that creates `marker` when run.
#[cfg(unix)]
fn trap(dir: &std::path::Path, marker: &std::path::Path) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let script = dir.join("trap.sh");
    std::fs::write(
        &script,
        format!("#!/bin/sh\ntouch '{}'\nexit 1\n", marker.display()),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    script
}

/// The traps are shell scripts, so the tests that read everything only run on Unix.
#[cfg(unix)]
fn read_everything(client: &Git) {
    use ratelgit_lib::git::Scope;
    use ratelgit_lib::snapshot;
    let snapshot = snapshot::load(client, Some(&[])).unwrap();
    for line in snapshot.history.lines.iter().take(3) {
        let _ = client.commit_detail(&line.hash);
        if let Ok(files) = client.commit_files(&line.hash) {
            for file in files {
                let _ = client.diff(&file, Some(&line.hash), false);
            }
        }
    }
    let _ = client.history(&Scope(vec!["HEAD".into()]), 0, 10);
}

#[cfg(unix)]
#[test]
fn signature_display_does_not_run_the_repository_gpg_program() {
    let sandbox = sandbox();
    let root = sandbox.root.join("signed");
    init(&root);
    let marker = sandbox.root.join("PWNED_gpg");
    let script = trap(&sandbox.root, &marker);
    git(&root, &["config", "log.showSignature", "true"]);
    git(&root, &["config", "gpg.program", &git_path(&script)]);
    let empty_tree = git(&root, &["mktree"]).trim().to_string();
    let object = format!(
        "tree {empty_tree}\nauthor t <t@example.invalid> 1700000000 +0000\ncommitter t <t@example.invalid> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n abcd\n -----END PGP SIGNATURE-----\n\nsigned\n"
    );
    let hash = try_git(
        &root,
        &["hash-object", "-t", "commit", "-w", "--stdin"],
        Some(&object),
    )
    .unwrap();
    git(&root, &["update-ref", "refs/heads/main", hash.trim()]);
    read_everything(&Git::new(&root));
    assert!(!marker.exists(), "gpg.program ran");
}

#[cfg(unix)]
#[test]
fn reading_a_partial_clone_does_not_fetch_missing_objects() {
    let sandbox = sandbox();
    let root = sandbox.root.join("partial");
    init(&root);
    let marker = sandbox.root.join("PWNED_lazy");
    let missing_blob = "1234567890123456789012345678901234567890";
    let tree = try_git(
        &root,
        &["mktree", "--missing"],
        Some(&format!("100644 blob {missing_blob}\tsecret.txt\n")),
    )
    .unwrap();
    let commit = git(&root, &["commit-tree", tree.trim(), "-m", "Lazy"]);
    git(&root, &["update-ref", "refs/heads/main", commit.trim()]);
    git(&root, &["config", "extensions.partialClone", "origin"]);
    git(&root, &["config", "remote.origin.promisor", "true"]);
    git(
        &root,
        &["config", "remote.origin.url", &git_path(&sandbox.root)],
    );
    git(
        &root,
        &[
            "config",
            "remote.origin.uploadpack",
            &format!("touch '{}';", marker.display()),
        ],
    );
    read_everything(&Git::new(&root));
    assert!(
        !marker.exists(),
        "a lazy fetch ran the repository's uploadpack command"
    );
}

#[cfg(unix)]
#[test]
fn the_repository_fsmonitor_hook_is_not_run() {
    let sandbox = sandbox();
    let root = sandbox.root.join("fsmonitor");
    init(&root);
    put(&root, "a.txt", "a\n");
    commit_all(&root, "Base");
    let marker = sandbox.root.join("PWNED_fsm");
    let script = trap(&sandbox.root, &marker);
    git(&root, &["config", "core.fsmonitor", &git_path(&script)]);
    put(&root, "a.txt", "b\n");
    read_everything(&Git::new(&root));
    let _ = Git::new(&root).worktrees();
    assert!(!marker.exists(), "core.fsmonitor ran");
}

fn untracked(path: &str) -> ChangedFile {
    ChangedFile {
        path: path.into(),
        kind: ChangeKind::Untracked,
        status: "?".into(),
        conflict: None,
    }
}

#[test]
fn untracked_diffs_stay_inside_the_worktree() {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    init(&root);
    put(&root, "a.txt", "a\n");
    commit_all(&root, "Base");
    put(&sandbox.root, "secret.txt", "secret\n");
    put(&root, "new.txt", "new\n");
    let client = Git::new(&root);
    for path in [
        "../secret.txt",
        "dir/../../secret.txt",
        "/etc/hosts",
        "C:/x",
        "a\\..\\..\\secret.txt",
        ":(top)x",
    ] {
        let result = client.diff(&untracked(path), None, false);
        assert_eq!(result.unwrap_err().kind, ErrorKind::InvalidInput, "{path}");
    }
    let unlisted = client.diff(&untracked("a.txt"), None, false);
    assert_eq!(
        unlisted.unwrap_err().kind,
        ErrorKind::Stale,
        "a tracked file is not untracked"
    );
    assert!(client
        .diff(&untracked("new.txt"), None, false)
        .unwrap()
        .text
        .contains("+new"));
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(sandbox.root.join("secret.txt"), root.join("link.txt")).unwrap();
        let link = client.diff(&untracked("link.txt"), None, false).unwrap();
        assert!(
            !link.text.contains("+secret"),
            "a link is shown as a link, not followed"
        );
    }
}

#[test]
fn big_untracked_files_are_not_read_whole() {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    init(&root);
    put(&root, "a.txt", "a\n");
    commit_all(&root, "Base");
    let big = "x".repeat(64) + "\n";
    put(&root, "big.log", &big.repeat(200_000));
    let shown = Git::new(&root)
        .diff(&untracked("big.log"), None, false)
        .unwrap();
    assert!(shown.truncated);
    assert!(shown.text.len() < 5 * 1024 * 1024);
}

#[test]
fn opening_files_is_limited_to_conflicts_and_plain_documents() {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    init(&root);
    put(&root, "notes.txt", "base\n");
    put(&root, "run.sh", "base\n");
    commit_all(&root, "Base");
    git(&root, &["switch", "-q", "-c", "side"]);
    put(&root, "notes.txt", "side\n");
    put(&root, "run.sh", "side\n");
    commit_all(&root, "Side");
    git(&root, &["switch", "-q", "main"]);
    put(&root, "notes.txt", "main\n");
    put(&root, "run.sh", "main\n");
    put(&root, "plain.txt", "plain\n");
    commit_all(&root, "Main");
    assert!(try_git(&root, &["merge", "side"], None).is_err());
    let client = Git::new(&root);
    assert!(matches!(
        client.open_decision("notes.txt").unwrap(),
        OpenDecision::Open(_)
    ));
    assert!(
        matches!(
            client.open_decision("run.sh").unwrap(),
            OpenDecision::Reveal(_)
        ),
        "scripts are only revealed"
    );
    for refused in ["plain.txt", ".git/config", "../x", "missing.txt"] {
        assert!(client.open_decision(refused).is_err(), "{refused}");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            root.join("notes.txt"),
            std::fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        assert!(
            matches!(
                client.open_decision("notes.txt").unwrap(),
                OpenDecision::Reveal(_)
            ),
            "executable bit"
        );
    }
}

#[test]
fn a_redirected_work_tree_is_not_accepted() {
    let sandbox = sandbox();
    let root = sandbox.root.join("redirect");
    init(&root);
    put(&root, "a.txt", "a\n");
    commit_all(&root, "Base");
    let outside = sandbox.root.join("outside");
    std::fs::create_dir_all(&outside).unwrap();
    git(&root, &["config", "core.worktree", &git_path(&outside)]);
    let registry = Registry::new(Store::new(&sandbox.root.join("config")));
    let added = registry.add_folder(&git_path(&root));
    let refused = match added {
        Err(error) => error.kind == ErrorKind::NotFound || error.kind == ErrorKind::InvalidInput,
        Ok(project) => {
            project.worktree.is_none()
                && project.projects[0].worktrees.iter().all(|t| t.unavailable)
        }
    };
    assert!(
        refused,
        "a worktree whose top level is elsewhere is not used"
    );
    assert!(registry.resolve_worktree(&git_path(&root)).is_err());
    assert!(registry.resolve_worktree(&git_path(&outside)).is_err());
}

#[test]
fn a_worktree_of_another_repository_is_not_registered() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let other = sample_repository(&sandbox.root, "other");
    let linked = sandbox.root.join("linked");
    git(
        &repo,
        &["worktree", "add", "-q", &git_path(&linked), "side"],
    );
    // Point the linked worktree's .git file at the other repository.
    let other_gitdir = git_path(&other.join(".git"));
    std::fs::write(linked.join(".git"), format!("gitdir: {other_gitdir}\n")).unwrap();
    let registry = Registry::new(Store::new(&sandbox.root.join("config")));
    let added = registry.add_folder(&git_path(&repo)).unwrap();
    let tree = added.projects[0]
        .worktrees
        .iter()
        .find(|t| t.path == git_path(&linked))
        .unwrap();
    assert!(
        tree.unavailable,
        "a worktree that belongs to another repository is unavailable"
    );
    assert!(registry.resolve_worktree(&git_path(&linked)).is_err());
}
