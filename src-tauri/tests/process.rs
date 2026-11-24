//! Git must return on time even when a hook misbehaves.
#![cfg(unix)]

mod common;

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::{Duration, Instant};

use common::*;
use ratelgit_lib::git::{Action, Git, RunOptions};

fn hook(root: &Path, name: &str, body: &str) {
    let path = root.join(".git/hooks").join(name);
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn staged_repository() -> (Sandbox, std::path::PathBuf) {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    init(&root);
    put(&root, "a.txt", "a\n");
    commit_all(&root, "Base");
    put(&root, "a.txt", "b\n");
    git(&root, &["add", "a.txt"]);
    (sandbox, root)
}

#[test]
fn a_background_process_left_by_a_hook_does_not_hold_the_app() {
    let (_sandbox, root) = staged_repository();
    // The background sleep inherits Git's stdout and stderr and keeps them open.
    hook(&root, "pre-commit", "sleep 20 &\nexit 0");
    let started = Instant::now();
    Git::new(&root)
        .execute(&Action::Commit {
            message: "With hook".into(),
        })
        .unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(8),
        "took {:?}",
        started.elapsed()
    );
    assert_eq!(last_subject(&root), "With hook");
}

#[test]
fn a_hung_hook_is_stopped_at_the_timeout() {
    let (sandbox, root) = staged_repository();
    let marker = sandbox.root.join("survived");
    hook(
        &root,
        "pre-commit",
        &format!("sleep 4\ntouch '{}'", marker.display()),
    );
    let options = RunOptions {
        timeout: Duration::from_secs(1),
        ..RunOptions::writing()
    };
    let started = Instant::now();
    let result = Git::new(&root).run(&["commit", "-m", "Hung"], options);
    assert!(result.is_err());
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "took {:?}",
        started.elapsed()
    );
    std::thread::sleep(Duration::from_secs(5));
    assert!(!marker.exists(), "the hook was stopped together with Git");
}

#[test]
fn output_beyond_the_limit_stops_git() {
    let sandbox = sandbox();
    long_history(&sandbox.root, 2000);
    let options = RunOptions {
        output_limit: 4096,
        ..RunOptions::default()
    };
    let refused = Git::new(&sandbox.root).run(&["log", "--format=%H %s"], options);
    assert!(refused.unwrap_err().message.contains("output"));
    let (bytes, truncated) = Git::new(&sandbox.root)
        .run_capped(
            &["log", "--format=%H %s"],
            RunOptions::default().capped(4096),
        )
        .unwrap();
    assert!(truncated && bytes.len() <= 4096);
}

#[test]
fn a_hook_that_writes_a_lot_to_stderr_is_not_killed() {
    let (_sandbox, root) = staged_repository();
    // 3 MB of stderr, more than the app keeps; the hook must still finish normally.
    hook(
        &root,
        "pre-commit",
        "i=0; while [ $i -lt 3000 ]; do printf '%01024d\\n' 0 >&2; i=$((i+1)); done; exit 0",
    );
    Git::new(&root)
        .execute(&Action::Commit {
            message: "Noisy hook".into(),
        })
        .unwrap();
    assert_eq!(last_subject(&root), "Noisy hook");
}

#[test]
fn output_over_the_limit_is_never_returned_as_complete() {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    init(&root);
    put(&root, "big.txt", &"x".repeat(20_000));
    commit_all(&root, "Big");
    let client = Git::new(&root);
    for _ in 0..30 {
        let options = RunOptions {
            output_limit: 4096,
            ..RunOptions::default()
        };
        let result = client.run_bytes(&["cat-file", "-p", "HEAD:big.txt"], options);
        assert!(result.is_err(), "a cut output came back as complete");
    }
}
