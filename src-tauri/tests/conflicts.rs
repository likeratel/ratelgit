//! Resolving merge, rebase and cherry-pick conflicts inside the app.

mod common;

use std::path::{Path, PathBuf};

use common::*;
use ratelgit_lib::error::ErrorKind;
use ratelgit_lib::git::{
    Action, ChangedFile, ChunkChoice, ConflictKind, DocumentState, Git, Operation, Segment, Side,
};

/// `main` and `side` both edit line 2 and line 6 of `notes.txt`; returns the stopped repository.
fn merge_conflict(root: &Path, crlf: bool) -> (PathBuf, Git) {
    let repo = root.join("repo");
    init(&repo);
    let eol = if crlf { "\r\n" } else { "\n" };
    let text = |two: &str, six: &str| {
        [
            "one", two, "three", "four", "five", "5a", "5b", "5c", "5d", six, "seven",
        ]
        .iter()
        .map(|line| format!("{line}{eol}"))
        .collect::<String>()
    };
    put(&repo, "notes.txt", &text("two", "six"));
    commit_all(&repo, "Base");
    git(&repo, &["switch", "-q", "-c", "side"]);
    put(&repo, "notes.txt", &text("two (side)", "six (side)"));
    commit_all(&repo, "Side edits");
    git(&repo, &["switch", "-q", "main"]);
    put(&repo, "notes.txt", &text("two (main)", "six (main)"));
    commit_all(&repo, "Main edits");
    assert!(try_git(&repo, &["merge", "--no-edit", "side"], None).is_err());
    let client = Git::new(&repo);
    (repo, client)
}

fn conflicted(client: &Git) -> ChangedFile {
    client
        .working_files()
        .unwrap()
        .into_iter()
        .find(|f| f.is_conflicted())
        .expect("a conflicted file")
}

fn staged_paths(client: &Git) -> Vec<String> {
    client
        .working_files()
        .unwrap()
        .into_iter()
        .filter(|f| f.kind == ratelgit_lib::git::ChangeKind::Staged)
        .map(|f| f.path)
        .collect()
}

#[test]
fn merge_chunks_are_chosen_saved_staged_and_committed() {
    let sandbox = sandbox();
    let (repo, client) = merge_conflict(&sandbox.root, false);
    let state = client.operation_state().unwrap().unwrap();
    assert_eq!(state.kind, Operation::Merge);
    assert_eq!(state.ours.as_deref(), Some("main"));
    assert_eq!(state.theirs.as_deref(), Some("side"));
    assert_eq!(state.conflicts, 1);
    assert!(state.message.unwrap().starts_with("Merge branch 'side'"));

    let file = conflicted(&client);
    assert_eq!(file.conflict, Some(ConflictKind::BothModified));
    let document = client.load_conflict(&file.path).unwrap();
    assert_eq!(document.state, DocumentState::Ready);
    let labels: Vec<_> = document
        .segments
        .iter()
        .filter_map(|s| match s {
            Segment::Conflict {
                ours_label,
                theirs_label,
                ..
            } => Some((ours_label.clone(), theirs_label.clone())),
            Segment::Text { .. } => None,
        })
        .collect();
    assert_eq!(labels.len(), 2);
    assert_eq!(labels[0], ("HEAD".to_string(), "side".to_string()));
    let before = read(&repo, "notes.txt");

    let continue_early = client.execute(&Action::Continue {
        operation: Operation::Merge,
        message: None,
    });
    assert_eq!(continue_early.unwrap_err().kind, ErrorKind::InvalidInput);
    let short = client.execute(&Action::SaveResolution {
        file: file.clone(),
        fingerprint: document.fingerprint.clone().unwrap(),
        choices: vec![ChunkChoice::Ours],
    });
    assert!(short.is_err(), "every chunk needs a choice");
    assert_eq!(
        read(&repo, "notes.txt"),
        before,
        "nothing is written before all chunks are chosen"
    );

    client
        .execute(&Action::SaveResolution {
            file,
            fingerprint: document.fingerprint.unwrap(),
            choices: vec![ChunkChoice::Theirs, ChunkChoice::OursThenTheirs],
        })
        .unwrap();
    assert_eq!(
        read(&repo, "notes.txt"),
        "one\ntwo (side)\nthree\nfour\nfive\n5a\n5b\n5c\n5d\nsix (main)\nsix (side)\nseven\n"
    );
    assert_eq!(staged_paths(&client), vec!["notes.txt"]);
    assert_eq!(client.operation_state().unwrap().unwrap().conflicts, 0);
    client
        .execute(&Action::Continue {
            operation: Operation::Merge,
            message: Some("Merge side with both sixes".into()),
        })
        .unwrap();
    assert!(client.operation_state().unwrap().is_none());
    assert_eq!(last_subject(&repo), "Merge side with both sixes");
}

#[test]
fn whole_file_sides_and_marker_checks() {
    let sandbox = sandbox();
    let (repo, client) = merge_conflict(&sandbox.root, false);
    let file = conflicted(&client);
    let marked = client.execute(&Action::MarkResolved {
        file: file.clone(),
        force: false,
    });
    assert_eq!(marked.unwrap_err().kind, ErrorKind::ConflictMarkers);
    client
        .execute(&Action::ResolveSide {
            file,
            side: Side::Theirs,
        })
        .unwrap();
    assert!(read(&repo, "notes.txt").contains("two (side)"));
    assert_eq!(staged_paths(&client), vec!["notes.txt"]);
    client
        .execute(&Action::Abort {
            operation: Operation::Merge,
        })
        .unwrap();

    assert!(try_git(&repo, &["merge", "--no-edit", "side"], None).is_err());
    let file = conflicted(&client);
    client
        .execute(&Action::ResolveSide {
            file,
            side: Side::Ours,
        })
        .unwrap();
    assert!(read(&repo, "notes.txt").contains("two (main)"));
    client
        .execute(&Action::Abort {
            operation: Operation::Merge,
        })
        .unwrap();

    assert!(try_git(&repo, &["merge", "--no-edit", "side"], None).is_err());
    let file = conflicted(&client);
    client
        .execute(&Action::MarkResolved { file, force: true })
        .unwrap();
    assert!(
        read(&repo, "notes.txt").contains("<<<<<<< HEAD"),
        "force keeps the markers"
    );
    assert!(client
        .execute(&Action::Continue {
            operation: Operation::Merge,
            message: None
        })
        .is_ok());
}

#[test]
fn delete_conflicts_keep_or_remove_the_file() {
    let sandbox = sandbox();
    let repo = sandbox.root.join("repo");
    init(&repo);
    put(&repo, "keep.txt", "base\n");
    put(&repo, "drop.txt", "base\n");
    commit_all(&repo, "Base");
    git(&repo, &["switch", "-q", "-c", "side"]);
    git(&repo, &["rm", "-q", "keep.txt", "drop.txt"]);
    commit_all(&repo, "Delete both on side");
    git(&repo, &["switch", "-q", "main"]);
    put(&repo, "keep.txt", "main\n");
    put(&repo, "drop.txt", "main\n");
    commit_all(&repo, "Edit both on main");
    assert!(try_git(&repo, &["merge", "--no-edit", "side"], None).is_err());
    let client = Git::new(&repo);
    let files = client.working_files().unwrap();
    assert!(files
        .iter()
        .all(|f| f.conflict == Some(ConflictKind::DeletedByThem)));
    let by_path = |path: &str| files.iter().find(|f| f.path == path).unwrap().clone();

    client
        .execute(&Action::KeepFile {
            file: by_path("keep.txt"),
        })
        .unwrap();
    client
        .execute(&Action::ResolveSide {
            file: by_path("drop.txt"),
            side: Side::Theirs,
        })
        .unwrap();
    assert_eq!(read(&repo, "keep.txt"), "main\n");
    assert!(!repo.join("drop.txt").exists(), "theirs deleted it");
    assert_eq!(client.unmerged_count().unwrap(), 0);
    let resolved = client.load_conflict("drop.txt").unwrap_err();
    assert_eq!(
        resolved.kind,
        ErrorKind::Stale,
        "a resolved file is no longer read as a conflict"
    );
    client
        .execute(&Action::Continue {
            operation: Operation::Merge,
            message: None,
        })
        .unwrap();
    assert!(git(&repo, &["ls-files"]).contains("keep.txt"));
    assert!(!git(&repo, &["ls-files"]).contains("drop.txt"));
}

#[test]
fn rebase_stops_at_each_conflict_and_continues() {
    let sandbox = sandbox();
    let repo = sandbox.root.join("repo");
    init(&repo);
    put(&repo, "a.txt", "base\n");
    put(&repo, "b.txt", "base\n");
    commit_all(&repo, "Base");
    git(&repo, &["switch", "-q", "-c", "topic"]);
    put(&repo, "a.txt", "topic\n");
    commit_all(&repo, "Topic edits a");
    put(&repo, "b.txt", "topic\n");
    commit_all(&repo, "Topic edits b");
    git(&repo, &["switch", "-q", "main"]);
    put(&repo, "a.txt", "main\n");
    put(&repo, "b.txt", "main\n");
    commit_all(&repo, "Main edits both");
    git(&repo, &["switch", "-q", "topic"]);
    let client = Git::new(&repo);
    assert!(client
        .execute(&Action::Rebase {
            reference: "refs/heads/main".into()
        })
        .is_err());

    let first = client.operation_state().unwrap().unwrap();
    assert_eq!(first.kind, Operation::Rebase);
    assert_eq!(first.branch.as_deref(), Some("topic"));
    assert_eq!(first.ours.as_deref(), Some("main"));
    assert!(first.theirs.unwrap().ends_with("Topic edits a"));
    assert_eq!((first.step, first.total), (Some(1), Some(2)));
    let document = client.load_conflict("a.txt").unwrap();
    let Segment::Conflict { theirs_label, .. } = &document.segments[0] else {
        panic!()
    };
    assert!(
        theirs_label.contains("Topic edits a"),
        "rebase labels name the replayed commit"
    );
    client
        .execute(&Action::SaveResolution {
            file: conflicted(&client),
            fingerprint: document.fingerprint.unwrap(),
            choices: vec![ChunkChoice::Theirs],
        })
        .unwrap();
    client
        .execute(&Action::Continue {
            operation: Operation::Rebase,
            message: None,
        })
        .unwrap();

    let second = client.operation_state().unwrap().unwrap();
    assert_eq!(
        (second.step, second.total),
        (Some(2), Some(2)),
        "stopped at the next conflict"
    );
    assert_eq!(conflicted(&client).path, "b.txt");
    client
        .execute(&Action::ResolveSide {
            file: conflicted(&client),
            side: Side::Theirs, // in a rebase "theirs" is the commit being replayed
        })
        .unwrap();
    client
        .execute(&Action::Continue {
            operation: Operation::Rebase,
            message: None,
        })
        .unwrap();
    assert!(client.operation_state().unwrap().is_none());
    assert_eq!(read(&repo, "a.txt"), "topic\n");
    assert_eq!(read(&repo, "b.txt"), "topic\n");
    assert_eq!(last_subject(&repo), "Topic edits b");
}

#[test]
fn external_cherry_pick_is_detected_and_aborted() {
    let sandbox = sandbox();
    let (repo, client) = merge_conflict(&sandbox.root, false);
    client
        .execute(&Action::Abort {
            operation: Operation::Merge,
        })
        .unwrap();
    let pick = git(&repo, &["rev-parse", "side"]).trim().to_string();
    assert!(try_git(&repo, &["cherry-pick", &pick], None).is_err());
    let state = client.operation_state().unwrap().unwrap();
    assert_eq!(state.kind, Operation::CherryPick);
    assert!(state.theirs.unwrap().ends_with("Side edits"));
    let wrong = client.execute(&Action::Abort {
        operation: Operation::Merge,
    });
    assert_eq!(wrong.unwrap_err().kind, ErrorKind::Stale);
    client
        .execute(&Action::Abort {
            operation: Operation::CherryPick,
        })
        .unwrap();
    assert!(client.operation_state().unwrap().is_none());
}

#[test]
fn saving_refuses_a_file_changed_on_disk() {
    let sandbox = sandbox();
    let (repo, client) = merge_conflict(&sandbox.root, false);
    let document = client.load_conflict("notes.txt").unwrap();
    let edited = read(&repo, "notes.txt").replace("one", "ONE");
    put(&repo, "notes.txt", &edited);
    let result = client.execute(&Action::SaveResolution {
        file: conflicted(&client),
        fingerprint: document.fingerprint.unwrap(),
        choices: vec![ChunkChoice::Ours, ChunkChoice::Ours],
    });
    assert_eq!(result.unwrap_err().kind, ErrorKind::Stale);
    assert_eq!(read(&repo, "notes.txt"), edited, "the newer file is kept");
}

#[test]
fn crlf_and_diff3_base_are_preserved() {
    let sandbox = sandbox();
    let repo = sandbox.root.join("repo");
    init(&repo);
    git(&repo, &["config", "merge.conflictStyle", "diff3"]);
    put(&repo, "win.txt", "a\r\nb\r\nc");
    commit_all(&repo, "Base");
    git(&repo, &["switch", "-q", "-c", "side"]);
    put(&repo, "win.txt", "a\r\nside\r\nc");
    commit_all(&repo, "Side");
    git(&repo, &["switch", "-q", "main"]);
    put(&repo, "win.txt", "a\r\nmain\r\nc");
    commit_all(&repo, "Main");
    assert!(try_git(&repo, &["merge", "--no-edit", "side"], None).is_err());
    let client = Git::new(&repo);
    let document = client.load_conflict("win.txt").unwrap();
    let Segment::Conflict {
        base, base_label, ..
    } = &document.segments[1]
    else {
        panic!()
    };
    assert_eq!(base.as_deref(), Some(&["b\r\n".to_string()][..]));
    assert!(base_label.is_some());
    client
        .execute(&Action::SaveResolution {
            file: conflicted(&client),
            fingerprint: document.fingerprint.unwrap(),
            choices: vec![ChunkChoice::TheirsThenOurs],
        })
        .unwrap();
    assert_eq!(
        read(&repo, "win.txt"),
        "a\r\nside\r\nmain\r\nc",
        "CRLF and the missing final newline stay"
    );
}

#[test]
fn conflict_files_must_stay_inside_the_worktree() {
    let sandbox = sandbox();
    let (_repo, client) = merge_conflict(&sandbox.root, false);
    assert!(client.load_conflict("../outside.txt").is_err());
    put(&_repo, "plain.txt", "not conflicted\n");
    let plain = client.load_conflict("plain.txt").unwrap_err();
    assert_eq!(
        plain.kind,
        ErrorKind::Stale,
        "only conflicted files are read"
    );
    assert!(client.load_conflict("/etc/hosts").is_err());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("/etc/hosts", _repo.join("link.txt")).unwrap();
        assert!(client.file_in_worktree("link.txt").is_err());
    }
}
