//! Keeps the UI's zod schemas and fake core honest about what the real core returns.
//!
//! The test drives the real core against a temporary repository and records one response per
//! command in `src/bridge/fixtures/core-samples.json`; `src/bridge/contract.test.ts` parses
//! those samples with the zod schemas. Here the fresh responses must have the same shape (every
//! key path and value type) as the committed file. After changing a payload on purpose, run
//! `UPDATE_CONTRACT_SAMPLES=1 cargo test --test contract` and commit the new file.
//!
//! Requests go the other way: `src/bridge/fixtures/requests.json` lists the action and file
//! payloads the UI sends, and both sides must accept every one of them.

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use common::*;
use ratelgit_lib::git::{Action, ChangeKind, ChangedFile, CommitInfo, Git, RemoveOptions, Scope};
use ratelgit_lib::projects::Registry;
use ratelgit_lib::snapshot;
use ratelgit_lib::store::{Preferences, Store, UiPreferences};
use serde_json::{json, Value};

const PLACEHOLDER_ROOT: &str = "/work";

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/bridge/fixtures")
}

/// Every `path: type` pair in a JSON value; array items share one path.
fn shape(value: &Value, path: &str, into: &mut BTreeSet<String>) {
    let kind = match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(items) => {
            items
                .iter()
                .for_each(|item| shape(item, &format!("{path}[]"), into));
            "array"
        }
        Value::Object(map) => {
            map.iter()
                .for_each(|(key, item)| shape(item, &format!("{path}.{key}"), into));
            "object"
        }
    };
    into.insert(format!("{path}: {kind}"));
}

/// Replaces the temporary folder with a fixed placeholder so the file holds no machine paths.
fn anonymize(value: Value, root: &str) -> Value {
    match value {
        Value::String(text) => Value::String(text.replace(root, PLACEHOLDER_ROOT)),
        Value::Array(items) => {
            Value::Array(items.into_iter().map(|v| anonymize(v, root)).collect())
        }
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, v)| (key.replace(root, PLACEHOLDER_ROOT), anonymize(v, root)))
                .collect(),
        ),
        other => other,
    }
}

fn to_json<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap()
}

/// A repository with a conflicted merge in a linked worktree, a stash, a tag, an upstream and
/// working changes, so optional fields show up both empty and filled.
fn scenario(root: &Path) -> (PathBuf, PathBuf) {
    let repo = sample_repository(root, "sample");
    put(&repo, "notes.txt", "draft\n");
    git(
        &repo,
        &[
            "stash",
            "push",
            "-q",
            "--include-untracked",
            "-m",
            "Draft notes",
        ],
    );
    put(&repo, "src/app.ts", "let value = 3\n");
    put(&repo, "README.md", "# Sample\n\nMore.\n");
    git(&repo, &["add", "README.md"]);
    put(&repo, "new.txt", "new\n");
    let linked = root.join("sample-login");
    git(
        &repo,
        &["worktree", "add", "-q", &git_path(&linked), "fix/login"],
    );
    git(&linked, &["switch", "-q", "-c", "clash", "main"]);
    put(&linked, "README.md", "# Clash\n");
    commit_all(&linked, "Edit readme on clash");
    git(&linked, &["switch", "-q", "fix/login"]);
    put(&linked, "README.md", "# Login\n");
    commit_all(&linked, "Edit readme on login");
    assert!(try_git(&linked, &["merge", "--no-edit", "clash"], None).is_err());
    (repo, linked)
}

fn samples(root: &Path) -> Value {
    let (repo, linked) = scenario(root);
    let registry = Registry::new(Store::new(&root.join("config")));
    let added = registry.add_folder(&git_path(&repo)).unwrap();
    let missing = git_path(&root.join("missing"));
    let mut preferences = registry.preferences();
    preferences.projects.push(missing.clone());
    Store::new(&root.join("config")).save(&preferences).unwrap();
    let registry = Registry::new(Store::new(&root.join("config")));
    let projects = registry.list_projects().unwrap();
    let saved = registry
        .save_preferences(
            BTreeMap::from([(git_path(&repo), vec!["refs/heads/fix/login".to_string()])]),
            UiPreferences {
                last_worktree: Some(git_path(&repo)),
                ..UiPreferences::default()
            },
        )
        .unwrap();

    let client = Git::new(&repo);
    let main_snapshot = snapshot::load(&client, Some(&[])).unwrap();
    let filtered = snapshot::load(&client, Some(&["refs/heads/fix/login".to_string()])).unwrap();
    let conflicted = snapshot::load(&Git::new(&linked), None).unwrap();
    let page = client.history(&Scope::all(), 2, 3).unwrap();
    let merge = main_snapshot
        .history
        .lines
        .iter()
        .find(|l| l.parents.len() == 2)
        .unwrap()
        .hash
        .clone();
    let commit = CommitInfo {
        detail: client.commit_detail(&merge).unwrap(),
        files: client.commit_files(&merge).unwrap(),
    };
    let unstaged = file_of(&client, ChangeKind::Unstaged);
    let diff = client.diff(&unstaged, None, false).unwrap();
    let error = client
        .execute(&Action::DeleteBranch {
            reference: "refs/heads/feature/x/y".into(),
            force: false,
        })
        .unwrap_err();
    let bootstrap = json!({ "preferences": to_json(&saved), "platform": "macos" });
    let defaults =
        json!({ "preferences": to_json(&Preferences::default()), "platform": "windows" });

    json!({
        "get_bootstrap": [defaults, bootstrap],
        "list_projects": to_json(&projects),
        "add_project": [to_json(&added), Value::Null],
        "remove_project": to_json(&vec![git_path(&repo)]),
        "list_worktrees": to_json(&registry.project_worktrees(&git_path(&linked)).unwrap()),
        "load_worktree": [to_json(&main_snapshot), to_json(&filtered), to_json(&conflicted)],
        "load_history": to_json(&page),
        "load_commit": to_json(&commit),
        "load_diff": to_json(&diff),
        "load_conflict": [
            to_json(&Git::new(&linked).load_conflict("README.md").unwrap()),
        ],
        "open_file": [json!({ "action": "opened" }), json!({ "action": "revealed" })],
        "choose_worktree_parent": [json!({ "token": "parent-1", "path": "/work" }), Value::Null],
        "plan_worktree": [
            to_json(&registry.plan_worktree(&git_path(&repo), None, "sample-next", Some("next")).unwrap()),
            to_json(&registry.plan_worktree(&git_path(&repo), None, "a/b", Some("main")).unwrap()),
        ],
        "worktree_removal": [
            to_json(&client.removal_preview(&git_path(&linked)).unwrap()),
            to_json(&client.removal_preview(&git_path(&repo)).unwrap()),
        ],
        "remove_worktree": [
            json!({ "branchDeleted": true, "remoteDeleted": false, "problem": "The worktree and the local branch were removed, but deleting the remote branch origin/x failed: offline" }),
            json!({ "branchDeleted": null, "remoteDeleted": null, "problem": null }),
        ],
        "run_action": Value::Null,
        "save_preferences": to_json(&saved),
        "error": to_json(&error),
    })
}

#[test]
fn core_responses_match_the_committed_samples() {
    let sandbox = sandbox();
    let fresh = anonymize(samples(&sandbox.root), &git_path(&sandbox.root));
    let file = fixtures().join("core-samples.json");
    if std::env::var_os("UPDATE_CONTRACT_SAMPLES").is_some() {
        let text = serde_json::to_string_pretty(&fresh).unwrap() + "\n";
        std::fs::write(&file, text).unwrap();
    }
    let committed: Value =
        serde_json::from_str(&std::fs::read_to_string(&file).expect("core-samples.json")).unwrap();
    let mut expected = BTreeSet::new();
    let mut actual = BTreeSet::new();
    shape(&committed, "", &mut expected);
    shape(&fresh, "", &mut actual);
    let missing: Vec<_> = expected.difference(&actual).collect();
    let extra: Vec<_> = actual.difference(&expected).collect();
    assert!(
        missing.is_empty() && extra.is_empty(),
        "core responses changed shape; update CONTRACT.md, the zod schemas and the samples.\nmissing: {missing:#?}\nextra: {extra:#?}"
    );
}

#[test]
fn every_request_the_ui_sends_is_accepted() {
    let text = std::fs::read_to_string(fixtures().join("requests.json")).expect("requests.json");
    let requests: Value = serde_json::from_str(&text).unwrap();
    let actions = requests["actions"].as_array().unwrap();
    assert!(actions.len() >= 20);
    for action in actions {
        serde_json::from_value::<Action>(action.clone())
            .unwrap_or_else(|error| panic!("{action}: {error}"));
    }
    for file in requests["files"].as_array().unwrap() {
        serde_json::from_value::<ChangedFile>(file.clone())
            .unwrap_or_else(|error| panic!("{file}: {error}"));
    }
    for options in requests["removeOptions"].as_array().unwrap() {
        serde_json::from_value::<RemoveOptions>(options.clone())
            .unwrap_or_else(|error| panic!("{options}: {error}"));
    }
    let ui = requests["ui"].clone();
    serde_json::from_value::<UiPreferences>(ui).unwrap();
    let unknown = json!({ "type": "fetch", "extra": true });
    assert!(
        serde_json::from_value::<Action>(unknown).is_err(),
        "unknown fields are refused"
    );
    let wrong = json!({ "type": "resetHard" });
    assert!(serde_json::from_value::<Action>(wrong).is_err());
}
