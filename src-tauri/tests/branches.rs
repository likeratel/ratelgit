//! Ported from the SwiftUI version's BranchTests.

mod common;

use common::*;
use ratelgit_lib::error::ErrorKind;
use ratelgit_lib::git::{Action, Git, Operation, RefKind};

fn act(client: &Git, action: Action) -> Result<(), ratelgit_lib::error::AppError> {
    client.execute(&action)
}

#[test]
fn rename_and_delete_refuse_unmerged_without_force() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let client = Git::new(&repo);

    act(
        &client,
        Action::RenameBranch {
            reference: "refs/heads/fix/login".into(),
            name: "fix/sign-in".into(),
        },
    )
    .unwrap();
    assert!(has_ref(&client, "refs/heads/fix/sign-in"));
    assert!(!has_ref(&client, "refs/heads/fix/login"));
    for bad in ["", "-x", "has space", "bad..name", "ends.lock"] {
        let result = act(
            &client,
            Action::RenameBranch {
                reference: "refs/heads/side".into(),
                name: bad.into(),
            },
        );
        assert_eq!(result.unwrap_err().kind, ErrorKind::InvalidInput, "{bad}");
    }

    let unmerged = "refs/heads/fix/sign-in".to_string();
    let refused = act(
        &client,
        Action::DeleteBranch {
            reference: unmerged.clone(),
            force: false,
        },
    );
    let error = refused.unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotFullyMerged, "{}", error.message);
    assert!(
        has_ref(&client, &unmerged),
        "nothing is deleted before confirming"
    );
    act(
        &client,
        Action::DeleteBranch {
            reference: unmerged.clone(),
            force: true,
        },
    )
    .unwrap();
    assert!(!has_ref(&client, &unmerged));
    act(
        &client,
        Action::DeleteBranch {
            reference: "refs/heads/side".into(),
            force: false,
        },
    )
    .unwrap();
    assert!(
        act(
            &client,
            Action::DeleteBranch {
                reference: "refs/heads/main".into(),
                force: true
            }
        )
        .is_err(),
        "the checked-out branch cannot be deleted"
    );
    let tag = act(
        &client,
        Action::DeleteBranch {
            reference: "refs/tags/v1.0".into(),
            force: true,
        },
    );
    assert_eq!(tag.unwrap_err().kind, ErrorKind::InvalidInput);
}

#[test]
fn add_worktree_and_check_out_remote_branch() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let client = Git::new(&repo);
    let location = sandbox.root.join("sample-feature");
    client
        .add_worktree("refs/heads/feature/x/y", &location)
        .unwrap();
    let trees = client.worktrees().unwrap();
    let last = trees.last().unwrap();
    assert_eq!(last.branch.as_deref(), Some("feature/x/y"));
    assert_eq!(last.path, git_path(&location));
    assert!(!last.is_main && trees[0].is_main);
    let checked_out = reference(&client, "refs/heads/feature/x/y");
    assert_eq!(
        checked_out.worktree_path.as_deref(),
        Some(git_path(&location).as_str())
    );
    assert!(!checked_out.is_head);
    assert!(reference(&client, "refs/heads/main").is_head);
    assert!(reference(&Git::new(&location), "refs/heads/feature/x/y").is_head);
    let relative = client.add_worktree("refs/heads/side", std::path::Path::new("relative/path"));
    assert_eq!(relative.unwrap_err().kind, ErrorKind::InvalidInput);
    let unresolved = act(
        &client,
        Action::AddWorktree {
            branch: ratelgit_lib::git::WorktreeBranch::Existing {
                reference: "refs/heads/side".into(),
            },
            parent: None,
            folder: "x".into(),
        },
    );
    assert_eq!(unresolved.unwrap_err().kind, ErrorKind::InvalidInput);
    assert!(
        client.add_worktree("refs/heads/side", &location).is_err(),
        "a non-empty folder is refused"
    );
    assert!(
        act(
            &client,
            Action::SwitchBranch {
                reference: checked_out.id.clone()
            }
        )
        .is_err(),
        "busy in another worktree"
    );

    git(&repo, &["branch", "-q", "-D", "fix/login"]);
    git(&repo, &["push", "-q", "origin", "main:fix/login"]);
    git(&repo, &["fetch", "-q", "origin"]);
    let remote = "refs/remotes/origin/fix/login".to_string();
    assert_eq!(client.tracking_name(&remote).unwrap(), "fix/login");
    act(
        &client,
        Action::CheckoutRemote {
            reference: remote.clone(),
        },
    )
    .unwrap();
    let tracking = client.tracking().unwrap().unwrap();
    assert_eq!(tracking.branch, "fix/login");
    assert_eq!(tracking.remote, "origin");
    assert!(
        act(&client, Action::CheckoutRemote { reference: remote }).is_err(),
        "the local branch already exists"
    );
}

#[test]
fn merge_conflict_reports_state_and_abort_restores() {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    init(&root);
    put(&root, "conflict.txt", "base\n");
    commit_all(&root, "Base");
    git(&root, &["switch", "-q", "-c", "side"]);
    put(&root, "conflict.txt", "side\n");
    commit_all(&root, "Side");
    git(&root, &["switch", "-q", "main"]);
    put(&root, "conflict.txt", "main\n");
    commit_all(&root, "Main");
    let client = Git::new(&root);
    let side = "refs/heads/side".to_string();

    assert_eq!(client.operation_in_progress().unwrap(), None);
    let error = act(
        &client,
        Action::Merge {
            reference: side.clone(),
        },
    )
    .unwrap_err();
    assert!(error.message.contains("CONFLICT"), "{}", error.message);
    assert_eq!(
        client.operation_in_progress().unwrap(),
        Some(Operation::Merge)
    );
    let files = client.working_files().unwrap();
    assert_eq!(
        files.iter().map(|f| f.status.as_str()).collect::<Vec<_>>(),
        vec!["U"]
    );
    assert!(act(
        &client,
        Action::Discard {
            file: files[0].clone()
        }
    )
    .is_err());
    let wrong = act(
        &client,
        Action::Abort {
            operation: Operation::Rebase,
        },
    );
    assert_eq!(wrong.unwrap_err().kind, ErrorKind::Stale);
    act(
        &client,
        Action::Abort {
            operation: Operation::Merge,
        },
    )
    .unwrap();
    assert_eq!(client.operation_in_progress().unwrap(), None);
    assert_eq!(read(&root, "conflict.txt"), "main\n");

    assert!(act(&client, Action::Rebase { reference: side }).is_err());
    assert_eq!(
        client.operation_in_progress().unwrap(),
        Some(Operation::Rebase)
    );
    act(
        &client,
        Action::Abort {
            operation: Operation::Rebase,
        },
    )
    .unwrap();
    assert_eq!(client.operation_in_progress().unwrap(), None);
    assert_eq!(last_subject(&root), "Main");

    put(&root, "other.txt", "clean\n");
    commit_all(&root, "Other");
    git(&root, &["switch", "-q", "-c", "topic"]);
    put(&root, "topic.txt", "topic\n");
    commit_all(&root, "Topic");
    git(&root, &["switch", "-q", "main"]);
    act(
        &client,
        Action::Merge {
            reference: "refs/heads/topic".into(),
        },
    )
    .unwrap();
    assert_eq!(last_subject(&root), "Topic", "fast-forward when possible");
}

#[test]
fn stash_drop_checks_the_index_still_matches() {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    init(&root);
    put(&root, "a.txt", "base\n");
    commit_all(&root, "Base");
    let client = Git::new(&root);
    let stashes = |client: &Git| {
        client
            .references()
            .unwrap()
            .into_iter()
            .filter(|r| r.kind == RefKind::Stash)
            .collect::<Vec<_>>()
    };
    put(&root, "a.txt", "first\n");
    act(
        &client,
        Action::Stash {
            message: "first".into(),
        },
    )
    .unwrap();
    let first = stashes(&client)[0].clone();
    put(&root, "a.txt", "second\n");
    act(
        &client,
        Action::Stash {
            message: "second".into(),
        },
    )
    .unwrap();
    let revision = first.target.clone().unwrap();
    let stale = act(
        &client,
        Action::DropStash {
            stash: first.id.clone(),
            revision,
        },
    );
    assert_eq!(
        stale.unwrap_err().kind,
        ErrorKind::Stale,
        "stash@{{0}} names another stash"
    );
    let current = stashes(&client)
        .into_iter()
        .find(|r| r.subject.as_deref().is_some_and(|s| s.contains("first")))
        .unwrap();
    act(
        &client,
        Action::DropStash {
            stash: current.id.clone(),
            revision: current.target.clone().unwrap(),
        },
    )
    .unwrap();
    let remaining = stashes(&client);
    assert_eq!(remaining.len(), 1);
    assert!(remaining[0].subject.as_deref().unwrap().contains("second"));
    assert!(act(
        &client,
        Action::DropStash {
            stash: "stash@{0}; rm".into(),
            revision: remaining[0].target.clone().unwrap(),
        }
    )
    .is_err());
}

#[test]
fn merge_rebase_and_worktree_use_the_branch_when_a_tag_has_the_same_name() {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    init(&root);
    put(&root, "a.txt", "base\n");
    commit_all(&root, "Base");
    git(&root, &["switch", "-q", "-c", "topic"]);
    put(&root, "t.txt", "topic\n");
    commit_all(&root, "Topic work");
    git(&root, &["switch", "-q", "main"]);
    put(&root, "m.txt", "main\n");
    commit_all(&root, "Main work");
    // A tag called "topic" on the base commit: the short name is ambiguous.
    git(&root, &["tag", "topic", "main~1"]);
    let client = Git::new(&root);

    act(
        &client,
        Action::Merge {
            reference: "refs/heads/topic".into(),
        },
    )
    .unwrap();
    assert!(
        root.join("t.txt").exists(),
        "the branch was merged, not the tag"
    );
    assert!(last_subject(&root).starts_with("Merge branch 'topic'"));

    git(
        &root,
        &["switch", "-q", "-c", "other", "refs/heads/topic~1"],
    );
    put(&root, "o.txt", "other\n");
    commit_all(&root, "Other work");
    act(
        &client,
        Action::Rebase {
            reference: "refs/heads/topic".into(),
        },
    )
    .unwrap();
    let onto = git(&root, &["rev-parse", "HEAD~1"]);
    assert_eq!(
        onto,
        git(&root, &["rev-parse", "refs/heads/topic"]),
        "rebased onto the branch"
    );

    let location = sandbox.root.join("topic-tree");
    client.add_worktree("refs/heads/topic", &location).unwrap();
    let trees = client.worktrees().unwrap();
    let added = trees
        .iter()
        .find(|t| t.path == git_path(&location))
        .unwrap();
    assert_eq!(
        added.branch.as_deref(),
        Some("topic"),
        "the branch is checked out, not a detached tag"
    );
}

#[test]
fn merge_commit_message_has_no_conflict_comments() {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    init(&root);
    put(&root, "f", "a\nb\nc\n");
    commit_all(&root, "Base");
    git(&root, &["switch", "-q", "-c", "side"]);
    put(&root, "f", "a\nB1\nc\n");
    commit_all(&root, "Side");
    git(&root, &["switch", "-q", "main"]);
    put(&root, "f", "a\nB2\nc\n");
    commit_all(&root, "Main");
    assert!(try_git(&root, &["merge", "--no-edit", "side"], None).is_err());
    put(&root, "f", "a\nB3\nc\n");
    git(&root, &["add", "f"]);
    let client = Git::new(&root);
    act(
        &client,
        Action::Continue {
            operation: Operation::Merge,
            message: None,
        },
    )
    .unwrap();
    let message = git(&root, &["log", "-1", "--format=%B"]);
    assert_eq!(message.trim(), "Merge branch 'side'");
}

#[test]
fn a_merge_message_keeps_the_users_hash_lines_but_not_git_comments() {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    init(&root);
    put(&root, "f", "a\nb\nc\n");
    commit_all(&root, "Base");
    git(&root, &["switch", "-q", "-c", "side"]);
    put(&root, "f", "a\nB1\nc\n");
    commit_all(&root, "Side");
    git(&root, &["switch", "-q", "main"]);
    put(&root, "f", "a\nB2\nc\n");
    commit_all(&root, "Main");
    assert!(try_git(&root, &["merge", "--no-edit", "side"], None).is_err());
    put(&root, "f", "a\nB3\nc\n");
    git(&root, &["add", "f"]);
    let client = Git::new(&root);
    let prepared = client.operation_state().unwrap().unwrap().message.unwrap();
    assert!(!prepared.contains("# Conflicts"), "{prepared}");
    let message = format!("{prepared}\n\n#42 keeps the login fix");
    act(
        &client,
        Action::Continue {
            operation: Operation::Merge,
            message: Some(message),
        },
    )
    .unwrap();
    let body = git(&root, &["log", "-1", "--format=%B"]);
    assert!(body.contains("#42 keeps the login fix"), "{body}");
    assert!(!body.contains("Conflicts"), "{body}");
}
