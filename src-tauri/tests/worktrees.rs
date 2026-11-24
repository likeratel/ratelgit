//! Ported from the SwiftUI version's WorktreeTests.

mod common;

use common::*;
use ratelgit_lib::git::{Action, ChangeKind, Git, RefKind, Scope};

fn tip_subject(client: &Git, reference: &str) -> String {
    let scope = Scope(vec![reference.to_string()]);
    client.history(&scope, 0, 1).unwrap().lines[0]
        .subject
        .clone()
}

#[test]
fn switch_between_worktrees_with_different_history_and_changes() {
    let sandbox = sandbox();
    let primary = sandbox.root.join("primary");
    let linked = sandbox.root.join("linked worktree");
    init(&primary);
    put(&primary, "shared.txt", "base\n");
    commit_all(&primary, "Base");
    git(
        &primary,
        &["worktree", "add", "-q", "-b", "feature", &git_path(&linked)],
    );
    put(&linked, "feature.txt", "feature commit\n");
    commit_all(&linked, "Feature commit");
    git(&linked, &["tag", "-a", "v1", "-m", "Version"]);
    git(
        &primary,
        &[
            "update-ref",
            "refs/remotes/origin/feature",
            "refs/heads/feature",
        ],
    );
    put(&linked, "shared.txt", "stashed\n");
    git(&linked, &["stash", "push", "-q", "-m", "Feature stash"]);
    put(&primary, "shared.txt", "main working\n");
    put(&linked, "shared.txt", "feature staged\n");
    git(&linked, &["add", "shared.txt"]);
    put(&linked, "shared.txt", "feature unstaged\n");
    put(&linked, "new [file].txt", "new file\n");

    let trees = Git::new(&linked).worktrees().unwrap();
    let branches: Vec<_> = trees.iter().map(|t| t.branch.clone().unwrap()).collect();
    assert_eq!(branches, vec!["main", "feature"]);
    assert_eq!(
        trees.iter().map(|t| t.changes).collect::<Vec<_>>(),
        vec![Some(1), Some(2)]
    );
    let main = Git::new(&trees[0].path);
    let feature = Git::new(&trees[1].path);
    assert_eq!(tip_subject(&main, "HEAD"), "Base");
    let tip = feature
        .history(&Scope(vec!["HEAD".into()]), 0, 1)
        .unwrap()
        .lines[0]
        .clone();
    assert_eq!(tip.subject, "Feature commit");
    let commit_file = feature.commit_files(&tip.hash).unwrap()[0].clone();
    assert_eq!(commit_file.path, "feature.txt");
    assert!(feature
        .diff(&commit_file, Some(&tip.hash), false)
        .unwrap()
        .text
        .contains("+feature commit"));
    let main_file = main.working_files().unwrap()[0].clone();
    assert!(main
        .diff(&main_file, None, false)
        .unwrap()
        .text
        .contains("+main working"));
    for (kind, content) in [
        (ChangeKind::Staged, "+feature staged"),
        (ChangeKind::Unstaged, "+feature unstaged"),
        (ChangeKind::Untracked, "+new file"),
    ] {
        let file = file_of(&feature, kind);
        assert!(
            feature
                .diff(&file, None, false)
                .unwrap()
                .text
                .contains(content),
            "{kind:?}"
        );
    }
    let refs = main.references().unwrap();
    for kind in [
        RefKind::Local,
        RefKind::Remote,
        RefKind::Tag,
        RefKind::Stash,
    ] {
        assert!(refs.iter().any(|r| r.kind == kind), "{kind:?}");
    }
    for reference in [
        "refs/heads/feature",
        "refs/remotes/origin/feature",
        "refs/tags/v1",
    ] {
        let lines = main
            .history(&Scope(vec![reference.into()]), 0, 1)
            .unwrap()
            .lines;
        assert_eq!(lines[0].hash, tip.hash, "{reference}");
    }
    let stash = refs.iter().find(|r| r.kind == RefKind::Stash).unwrap();
    assert!(stash.target.is_some());

    git(&linked, &["checkout", "-q", "--detach"]);
    let detached = main.worktrees().unwrap();
    assert_eq!(detached.last().unwrap().branch, None);
    assert_eq!(tip_subject(&feature, "HEAD"), "Feature commit");
}

#[test]
fn unborn_repository_and_merge_commit_files() {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    init(&root);
    let client = Git::new(&root);
    assert_eq!(
        client.worktrees().unwrap()[0].branch.as_deref(),
        Some("main")
    );
    let empty = client.history(&Scope::all(), 0, 500).unwrap();
    assert!(empty.lines.is_empty() && empty.complete);
    assert!(client.working_files().unwrap().is_empty());
    assert!(client.tracking().unwrap().is_none());
    git(&root, &["commit", "-q", "--allow-empty", "-m", "Base"]);
    git(&root, &["checkout", "-q", "-b", "side"]);
    put(&root, "side.txt", "side\n");
    commit_all(&root, "Side");
    git(&root, &["checkout", "-q", "main"]);
    put(&root, "main.txt", "main\n");
    commit_all(&root, "Main");
    git(&root, &["merge", "-q", "--no-ff", "--no-edit", "side"]);
    let graph = client.history(&Scope(vec!["HEAD".into()]), 0, 500).unwrap();
    assert_eq!(graph.lines.len(), 4);
    assert_eq!(graph.lines[0].parents.len(), 2);
    let merge = graph.lines[0].hash.clone();
    let files = client.commit_files(&merge).unwrap();
    assert_eq!(
        files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(),
        vec!["side.txt"]
    );
    assert!(client
        .diff(&files[0], Some(&merge), false)
        .unwrap()
        .text
        .contains("+side"));
    let detail = client.commit_detail(&merge).unwrap();
    assert_eq!(detail.parents.len(), 2);
    assert_eq!(detail.email, "test@example.invalid");
    assert!(detail.message.starts_with("Merge branch 'side'"));
}

#[test]
fn mutations_stay_with_their_worktree() {
    let sandbox = sandbox();
    let root = sandbox.root.join("main");
    init(&root);
    let main = Git::new(&root);
    put(&root, "literal [file].txt", "first\n");
    main.execute(&Action::Stage {
        file: main.working_files().unwrap()[0].clone(),
    })
    .unwrap();
    put(&root, "literal [file].txt", "second\n");
    let staged = file_of(&main, ChangeKind::Staged);
    main.execute(&Action::Unstage { file: staged }).unwrap();
    let kinds: Vec<_> = main
        .working_files()
        .unwrap()
        .iter()
        .map(|f| f.kind)
        .collect();
    assert_eq!(
        kinds,
        vec![ChangeKind::Untracked],
        "unstaging in an unborn repository"
    );
    main.execute(&Action::Stage {
        file: main.working_files().unwrap()[0].clone(),
    })
    .unwrap();
    assert!(main
        .execute(&Action::Commit {
            message: "  \n".into()
        })
        .is_err());
    main.execute(&Action::Commit {
        message: "Initial from app".into(),
    })
    .unwrap();
    assert_eq!(last_subject(&root), "Initial from app");

    let feature = sandbox.root.join("feature");
    git(
        &root,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "feature",
            &git_path(&feature),
        ],
    );
    put(&feature, "draft.txt", "feature only\n");
    put(&root, "draft.txt", "main only\n");
    let feature_git = Git::new(&feature);
    feature_git
        .execute(&Action::Stage {
            file: feature_git.working_files().unwrap()[0].clone(),
        })
        .unwrap();
    assert_eq!(file_of(&main, ChangeKind::Untracked).path, "draft.txt");
    assert_eq!(file_of(&feature_git, ChangeKind::Staged).path, "draft.txt");
    feature_git
        .execute(&Action::Commit {
            message: "Feature draft".into(),
        })
        .unwrap();
    assert_eq!(last_subject(&feature), "Feature draft");
    let kinds: Vec<_> = main
        .working_files()
        .unwrap()
        .iter()
        .map(|f| f.kind)
        .collect();
    assert_eq!(kinds, vec![ChangeKind::Untracked]);
    assert!(main
        .execute(&Action::SwitchBranch {
            reference: "refs/heads/feature".into()
        })
        .is_err());

    main.execute(&Action::CreateBranch {
        name: "scratch".into(),
    })
    .unwrap();
    assert_eq!(
        main.worktrees().unwrap()[0].branch.as_deref(),
        Some("scratch")
    );
    main.execute(&Action::Stash {
        message: "save draft".into(),
    })
    .unwrap();
    assert!(main.working_files().unwrap().is_empty());
    let stash = main
        .references()
        .unwrap()
        .into_iter()
        .find(|r| r.kind == RefKind::Stash)
        .unwrap();
    put(&root, "later.txt", "different draft\n");
    main.execute(&Action::Stash {
        message: "newer stash".into(),
    })
    .unwrap();
    main.execute(&Action::ApplyStash {
        stash: "stash@{1}".into(),
        revision: stash.target.unwrap(),
    })
    .unwrap();
    let paths: Vec<_> = main
        .working_files()
        .unwrap()
        .into_iter()
        .map(|f| f.path)
        .collect();
    assert_eq!(paths, vec!["draft.txt"]);
}

#[test]
fn fetch_pull_and_push_against_local_remote() {
    let sandbox = sandbox();
    let remote = sandbox.root.join("remote.git");
    let first = sandbox.root.join("first");
    let second = sandbox.root.join("second");
    git(
        &sandbox.root,
        &["init", "-q", "--bare", "-b", "main", &git_path(&remote)],
    );
    git(
        &sandbox.root,
        &["clone", "-q", &git_path(&remote), &git_path(&first)],
    );
    configure_identity(&first);
    git(&first, &["commit", "-q", "--allow-empty", "-m", "Base"]);
    let client = Git::new(&first);
    assert!(client.tracking().unwrap().is_none());
    assert!(client.execute(&Action::Push {}).is_err());
    git(&first, &["push", "-q", "-u", "origin", "main"]);
    git(
        &sandbox.root,
        &["clone", "-q", &git_path(&remote), &git_path(&second)],
    );
    configure_identity(&second);
    git(
        &second,
        &["commit", "-q", "--allow-empty", "-m", "Upstream"],
    );
    git(&second, &["push", "-q"]);
    client.execute(&Action::Fetch {}).unwrap();
    assert_eq!(client.tracking().unwrap().unwrap().behind, 1);
    let worktree = &client.worktrees().unwrap()[0];
    assert_eq!((worktree.ahead, worktree.behind), (Some(0), Some(1)));
    client.execute(&Action::Pull {}).unwrap();
    assert_eq!(tip_subject(&client, "HEAD"), "Upstream");
    git(&first, &["commit", "-q", "--allow-empty", "-m", "Local"]);
    assert_eq!(client.tracking().unwrap().unwrap().ahead, 1);
    client.execute(&Action::Push {}).unwrap();
    assert_eq!(client.tracking().unwrap().unwrap().ahead, 0);
    git(
        &second,
        &["commit", "-q", "--allow-empty", "-m", "Other local"],
    );
    let divergent = Git::new(&second);
    divergent.execute(&Action::Fetch {}).unwrap();
    assert!(
        divergent.execute(&Action::Pull {}).is_err(),
        "pull is fast-forward only"
    );
    assert_eq!(tip_subject(&divergent, "HEAD"), "Other local");
}

#[test]
fn conflict_shows_one_unmerged_file_and_stage_resolves_it() {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    init(&root);
    put(&root, "conflict.txt", "base\n");
    commit_all(&root, "Base");
    git(&root, &["checkout", "-q", "-b", "side"]);
    put(&root, "conflict.txt", "side\n");
    commit_all(&root, "Side");
    git(&root, &["checkout", "-q", "main"]);
    put(&root, "conflict.txt", "main\n");
    commit_all(&root, "Main");
    assert!(try_git(&root, &["merge", "side"], None).is_err());
    let client = Git::new(&root);
    let files = client.working_files().unwrap();
    assert_eq!(files.len(), 1);
    assert!(files[0].is_conflicted());
    put(&root, "conflict.txt", "resolved\n");
    client
        .execute(&Action::Stage {
            file: files[0].clone(),
        })
        .unwrap();
    let kinds: Vec<_> = client
        .working_files()
        .unwrap()
        .iter()
        .map(|f| f.kind)
        .collect();
    assert_eq!(kinds, vec![ChangeKind::Staged]);
}
