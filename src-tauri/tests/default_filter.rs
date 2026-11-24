//! The default History filter: the current branch plus origin/main and origin/master when they
//! exist, worked out at load time.

mod common;

use std::collections::BTreeMap;
use std::path::Path;

use common::*;
use ratelgit_lib::git::Git;
use ratelgit_lib::snapshot::{self, default_filter};
use ratelgit_lib::store::{Store, UiPreferences};

const MAIN: &str = "refs/remotes/origin/main";
const MASTER: &str = "refs/remotes/origin/master";

fn repository_with_remote_branches(root: &Path, remote_branches: &[&str]) -> Git {
    init(root);
    put(root, "a.txt", "a\n");
    commit_all(root, "Base");
    for name in remote_branches {
        git(
            root,
            &["update-ref", &format!("refs/remotes/origin/{name}"), "HEAD"],
        );
    }
    git(root, &["switch", "-q", "-c", "topic"]);
    put(root, "b.txt", "b\n");
    commit_all(root, "Topic work");
    Git::new(root)
}

#[test]
fn default_filter_uses_the_remote_mainline_that_exists() {
    let sandbox = sandbox();
    let cases: [(&str, &[&str], Vec<&str>); 4] = [
        ("main-only", &["main"], vec!["HEAD", MAIN]),
        ("master-only", &["master"], vec!["HEAD", MASTER]),
        ("both", &["main", "master"], vec!["HEAD", MAIN, MASTER]),
        ("neither", &[], vec!["HEAD"]),
    ];
    for (name, remotes, expected) in cases {
        let client = repository_with_remote_branches(&sandbox.root.join(name), remotes);
        assert_eq!(default_filter(&client).unwrap(), expected, "{name}");
        let loaded = snapshot::load(&client, None).unwrap();
        assert_eq!(loaded.filter, expected, "{name}");
        assert_eq!(loaded.default_filter, expected, "{name}");
        assert!(
            loaded
                .history
                .lines
                .iter()
                .any(|l| l.subject == "Topic work"),
            "{name}"
        );
    }
}

#[test]
fn default_filter_follows_a_detached_head_and_an_unborn_repository() {
    let sandbox = sandbox();
    let client = repository_with_remote_branches(&sandbox.root.join("detached"), &["main"]);
    git(
        &sandbox.root.join("detached"),
        &["checkout", "-q", "--detach", "HEAD"],
    );
    let loaded = snapshot::load(&client, None).unwrap();
    assert_eq!(loaded.filter, vec!["HEAD", MAIN]);
    assert_eq!(
        loaded.history.lines[0].subject, "Topic work",
        "the detached commit is shown"
    );
    assert!(!loaded.head_hidden);

    let unborn = sandbox.root.join("unborn");
    init(&unborn);
    let loaded = snapshot::load(&Git::new(&unborn), None).unwrap();
    assert_eq!(loaded.default_filter, vec!["HEAD"]);
    assert!(loaded.history.lines.is_empty());
}

#[test]
fn an_explicit_empty_filter_shows_every_branch() {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    let client = repository_with_remote_branches(&root, &["main"]);
    git(&root, &["switch", "-q", "-c", "other", "HEAD~1"]);
    git(
        &root,
        &["commit", "-q", "--allow-empty", "-m", "Other only"],
    );
    let all = snapshot::load(&client, Some(&[])).unwrap();
    assert!(all.filter.is_empty());
    assert!(all.history.lines.iter().any(|l| l.subject == "Topic work"));
    let default = snapshot::load(&client, None).unwrap();
    assert!(
        !default
            .history
            .lines
            .iter()
            .any(|l| l.subject == "Topic work"),
        "topic is not on HEAD or origin/main"
    );
}

#[test]
fn settings_tell_the_default_filter_from_show_all() {
    let sandbox = sandbox();
    let config = sandbox.root.join("config");
    std::fs::create_dir_all(&config).unwrap();
    // Version 1 wrote an empty list when no filter was chosen: that means "default" now.
    std::fs::write(
        config.join("ratelgit.json"),
        r#"{"version":1,"projects":["/w/a","/w/b"],"filters":{"/w/a":[],"/w/b":["refs/heads/x"]}}"#,
    )
    .unwrap();
    let loaded = Store::new(&config).load();
    assert!(
        !loaded.filters.contains_key("/w/a"),
        "an old empty list is the default filter"
    );
    assert_eq!(loaded.filters["/w/b"], vec!["refs/heads/x"]);

    // "Show All" is an empty list in the current version and survives a relaunch.
    let saved = ratelgit_lib::store::Preferences {
        filters: BTreeMap::from([("/w/a".to_string(), Vec::new())]),
        ui: UiPreferences::default(),
        ..loaded
    }
    .sanitized();
    Store::new(&config).save(&saved).unwrap();
    let reloaded = Store::new(&config).load();
    assert_eq!(reloaded.filters.get("/w/a"), Some(&Vec::new()));
    assert!(!reloaded.filters.contains_key("/w/b"));
}
