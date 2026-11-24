//! Ported from the SwiftUI version's HistoryTests: all-ref graph, filter unions, paging.

mod common;

use std::collections::HashSet;

use common::*;
use ratelgit_lib::git::{Git, Scope, HISTORY_PAGE_SIZE};
use ratelgit_lib::snapshot;

fn scope(refs: &[&str]) -> Scope {
    Scope(refs.iter().map(|r| r.to_string()).collect())
}

fn subjects(page: &ratelgit_lib::git::HistoryPage) -> HashSet<String> {
    page.lines.iter().map(|l| l.subject.clone()).collect()
}

#[test]
fn all_refs_graph_and_filter_union() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let client = Git::new(&repo);

    let all = client.history(&Scope::all(), 0, HISTORY_PAGE_SIZE).unwrap();
    let titles = subjects(&all);
    for expected in [
        "Extend nested feature",
        "Fix login redirect",
        "Add side notes",
        "Initial commit",
    ] {
        assert!(titles.contains(expected), "{expected}");
    }
    let hashes: HashSet<_> = all.lines.iter().map(|l| &l.hash).collect();
    assert_eq!(all.lines.len(), hashes.len(), "each commit appears once");
    assert_eq!(
        all.lines.iter().map(|l| l.index).collect::<Vec<_>>(),
        (0..all.lines.len()).collect::<Vec<_>>()
    );
    assert!(all.complete);
    let labels: Vec<&String> = all.lines.iter().flat_map(|l| &l.refs).collect();
    assert!(labels.iter().any(|l| *l == "HEAD -> main"));
    assert!(labels.iter().any(|l| *l == "tag: v1.0"));
    assert!(labels.iter().any(|l| *l == "origin/feature/x/y"));

    let nested = client
        .history(&scope(&["refs/heads/feature/x/y"]), 0, 500)
        .unwrap();
    assert_eq!(nested.lines[0].subject, "Extend nested feature");
    assert!(!subjects(&nested).contains("Fix login redirect"));
    let login = client
        .history(&scope(&["refs/heads/fix/login"]), 0, 500)
        .unwrap();
    let union = client
        .history(
            &scope(&["refs/heads/feature/x/y", "refs/heads/fix/login"]),
            0,
            500,
        )
        .unwrap();
    for expected in [
        "Extend nested feature",
        "Fix login redirect",
        "Bump the value",
    ] {
        assert!(subjects(&union).contains(expected));
    }
    let expected: HashSet<_> = nested
        .lines
        .iter()
        .chain(&login.lines)
        .map(|l| &l.hash)
        .collect();
    assert_eq!(union.lines.len(), expected.len());

    assert!(!client.head_hidden(&Scope::all()).unwrap());
    assert!(
        !client
            .head_hidden(&scope(&["refs/heads/feature/x/y"]))
            .unwrap(),
        "main is an ancestor of the feature"
    );
    git(&repo, &["switch", "-q", "fix/login"]);
    assert!(client
        .head_hidden(&scope(&["refs/heads/feature/x/y"]))
        .unwrap());
    assert!(!client.head_hidden(&scope(&["HEAD"])).unwrap());
    assert!(client.history(&scope(&["--all"]), 0, 500).is_err());
    let deleted = client
        .history(&scope(&["refs/heads/deleted"]), 0, 500)
        .unwrap();
    assert!(deleted.lines.is_empty() && deleted.complete);
}

#[test]
fn pages_continue_one_listing() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let client = Git::new(&repo);
    let full = client.history(&Scope::all(), 0, 500).unwrap();
    let first = client.history(&Scope::all(), 0, 3).unwrap();
    let second = client.history(&Scope::all(), 3, 3).unwrap();
    let rest = client.history(&Scope::all(), 6, 100).unwrap();
    assert!(!first.complete && !second.complete && rest.complete);
    let joined: Vec<_> = [first.lines, second.lines.clone(), rest.lines]
        .concat()
        .into_iter()
        .map(|l| l.hash)
        .collect();
    assert_eq!(
        joined,
        full.lines
            .iter()
            .map(|l| l.hash.clone())
            .collect::<Vec<_>>()
    );
    assert_eq!(second.lines[0].index, 3);
}

#[test]
fn long_history_loads_in_pages() {
    let sandbox = sandbox();
    let total = HISTORY_PAGE_SIZE + 20;
    long_history(&sandbox.root, total);
    let client = Git::new(&sandbox.root);
    let first = client.history(&Scope::all(), 0, HISTORY_PAGE_SIZE).unwrap();
    assert_eq!(first.lines.len(), HISTORY_PAGE_SIZE);
    assert!(!first.complete);
    assert_eq!(
        first.lines.last().unwrap().parents.len(),
        1,
        "the lane runs on"
    );
    let next = client
        .history(&Scope::all(), HISTORY_PAGE_SIZE, HISTORY_PAGE_SIZE)
        .unwrap();
    assert_eq!(next.lines.len(), 20);
    assert!(next.complete);
    assert_eq!(next.lines.last().unwrap().subject, "Commit 1");
    assert_eq!(next.lines.last().unwrap().index, total - 1);
}

#[test]
fn snapshot_prunes_deleted_refs_and_reports_hidden_head() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    git(&repo, &["switch", "-q", "-c", "other"]);
    git(
        &repo,
        &["commit", "-q", "--allow-empty", "-m", "Other only"],
    );
    git(&repo, &["switch", "-q", "main"]);
    let client = Git::new(&repo);
    let filter = vec![
        "refs/heads/feature/x/y".to_string(),
        "refs/heads/fix/login".to_string(),
        "refs/heads/gone".to_string(),
    ];
    let snapshot = snapshot::load(&client, &filter).unwrap();
    assert_eq!(snapshot.filter, filter[..2].to_vec());
    let titles: HashSet<_> = snapshot
        .history
        .lines
        .iter()
        .map(|l| l.subject.as_str())
        .collect();
    assert!(titles.contains("Fix login redirect"));
    assert!(!titles.contains("Other only"));
    assert!(!snapshot.head_hidden);

    let head_only = snapshot::load(&client, &["HEAD".to_string()]).unwrap();
    assert_eq!(head_only.history.lines[0].subject, "Merge branch 'side'");
    let everything = snapshot::load(&client, &[]).unwrap();
    assert!(everything
        .history
        .lines
        .iter()
        .any(|l| l.subject == "Other only"));
}
