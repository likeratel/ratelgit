//! Ported from the SwiftUI version's project store tests, plus the worktree registry checks
//! every command relies on.

mod common;

use std::collections::BTreeMap;

use common::*;
use ratelgit_lib::error::ErrorKind;
use ratelgit_lib::projects::{ProjectState, Registry};
use ratelgit_lib::store::{Preferences, Store, UiPreferences};

#[test]
fn project_list_survives_relaunch_and_missing_folders() {
    let sandbox = sandbox();
    let config = sandbox.root.join("config");
    let repo = sample_repository(&sandbox.root, "sample");
    let linked = sandbox.root.join("linked");
    git(
        &repo,
        &["worktree", "add", "-q", &git_path(&linked), "side"],
    );
    let missing = git_path(&sandbox.root.join("gone"));
    Store::new(&config)
        .save(&Preferences {
            projects: vec![git_path(&linked), missing.clone(), git_path(&repo)],
            ..Preferences::default()
        })
        .unwrap();

    let registry = Registry::new(Store::new(&config));
    let projects = registry.list_projects().unwrap();
    let paths: Vec<_> = projects.iter().map(|p| p.path.clone()).collect();
    assert_eq!(
        paths,
        vec![git_path(&repo), missing.clone()],
        "a linked worktree resolves to its repository"
    );
    assert_eq!(projects[0].worktrees.len(), 2);
    assert_eq!(projects[0].state, ProjectState::Ready);
    assert_eq!(projects[1].state, ProjectState::Unavailable);
    assert_eq!(projects[1].reason.as_deref(), Some("Folder not found"));
    assert_eq!(Store::new(&config).load().projects, paths);

    registry.remove(&missing).unwrap();
    let relaunched = Registry::new(Store::new(&config));
    assert_eq!(relaunched.preferences().projects, vec![git_path(&repo)]);
}

#[test]
fn adding_a_folder_registers_its_repository_and_selects_that_worktree() {
    let sandbox = sandbox();
    let first = sample_repository(&sandbox.root, "first");
    let second = sample_repository(&sandbox.root, "second");
    let linked = sandbox.root.join("first-side");
    git(
        &first,
        &["worktree", "add", "-q", &git_path(&linked), "side"],
    );
    let registry = Registry::new(Store::new(&sandbox.root.join("config")));

    let added = registry.add_folder(&git_path(&linked.join("."))).unwrap();
    assert_eq!(added.projects.len(), 1);
    assert_eq!(added.projects[0].path, git_path(&first));
    assert_eq!(added.worktree.as_deref(), Some(git_path(&linked).as_str()));
    let again = registry.add_folder(&git_path(&first)).unwrap();
    assert_eq!(
        again.projects.len(),
        1,
        "the same repository is listed once"
    );
    let both = registry.add_folder(&git_path(&second)).unwrap();
    let names: Vec<_> = both.projects.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, vec!["first", "second"]);

    let plain = sandbox.root.join("plain");
    std::fs::create_dir_all(&plain).unwrap();
    let refused = registry.add_folder(&git_path(&plain)).unwrap_err();
    assert_eq!(refused.kind, ErrorKind::NotFound);
}

#[test]
fn only_registered_worktrees_are_accepted() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let stranger = sample_repository(&sandbox.root, "stranger");
    let registry = Registry::new(Store::new(&sandbox.root.join("config")));
    registry.add_folder(&git_path(&repo)).unwrap();

    assert!(registry.resolve_worktree(&git_path(&repo)).is_ok());
    let outside = registry.resolve_worktree(&git_path(&stranger)).unwrap_err();
    assert_eq!(outside.kind, ErrorKind::NotFound);
    let parent = registry
        .resolve_worktree(&git_path(&sandbox.root))
        .unwrap_err();
    assert_eq!(parent.kind, ErrorKind::NotFound);
    let traversal = format!("{}/../stranger", git_path(&repo));
    assert!(registry.resolve_worktree(&traversal).is_err());
    assert!(registry.resolve_worktree("").is_err());

    // A worktree added outside the app is found after one refresh.
    let later = sandbox.root.join("later");
    git(&repo, &["worktree", "add", "-q", &git_path(&later), "side"]);
    assert!(registry.resolve_worktree(&git_path(&later)).is_ok());
    assert_eq!(
        registry.project_worktrees(&git_path(&later)).unwrap().len(),
        2
    );

    registry.remove(&git_path(&repo)).unwrap();
    assert!(
        registry.resolve_worktree(&git_path(&repo)).is_err(),
        "removed projects are refused"
    );
}

#[test]
fn preferences_keep_filters_of_known_projects_only() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let config = sandbox.root.join("config");
    let registry = Registry::new(Store::new(&config));
    registry.add_folder(&git_path(&repo)).unwrap();
    let filters = BTreeMap::from([
        (git_path(&repo), vec!["refs/heads/fix/login".to_string()]),
        ("/unknown".to_string(), vec!["HEAD".to_string()]),
    ]);
    let saved = registry
        .save_preferences(
            filters,
            UiPreferences {
                sidebar_width: 300,
                ..UiPreferences::default()
            },
        )
        .unwrap();
    assert_eq!(saved.filters.len(), 1);
    assert_eq!(Store::new(&config).load().filters, saved.filters);
    assert_eq!(Store::new(&config).load().ui.sidebar_width, 300);
}

#[test]
fn a_project_removed_while_projects_are_read_stays_removed() {
    let sandbox = sandbox();
    let first = sample_repository(&sandbox.root, "first");
    let second = sample_repository(&sandbox.root, "second");
    let config = sandbox.root.join("config");
    let registry = std::sync::Arc::new(Registry::new(Store::new(&config)));
    registry.add_folder(&git_path(&first)).unwrap();
    registry.add_folder(&git_path(&second)).unwrap();
    // Resolve the list as it was, then remove a project before the result is saved.
    let stale = registry.preferences().projects;
    registry.remove(&git_path(&second)).unwrap();
    registry
        .finish_listing(&stale, &ratelgit_lib::projects::resolve_all(&stale))
        .unwrap();
    assert_eq!(registry.preferences().projects, vec![git_path(&first)]);
    assert_eq!(Store::new(&config).load().projects, vec![git_path(&first)]);
}

#[test]
fn settings_with_unknown_or_wrong_fields_keep_the_project_list() {
    let sandbox = sandbox();
    let config = sandbox.root.join("config");
    std::fs::create_dir_all(&config).unwrap();
    std::fs::write(
        config.join("ratelgit.json"),
        r#"{"version":2,"projects":["/w/a",7,"/w/b"],"filters":{"/w/a":["refs/heads/x"]},
           "ui":{"diffLayout":"split","newerOption":true,"sidebarWidth":"wide"},"later":1}"#,
    )
    .unwrap();
    let loaded = Store::new(&config).load();
    assert_eq!(loaded.projects, vec!["/w/a", "/w/b"]);
    assert_eq!(loaded.filters.len(), 1);
    assert_eq!(
        loaded.ui.diff_layout,
        ratelgit_lib::store::DiffLayout::Split
    );
    assert!(
        !config.join("ratelgit.json.corrupt").exists(),
        "not treated as corrupt"
    );
}

#[test]
fn new_worktrees_go_into_a_chosen_or_default_parent_folder() {
    let sandbox = sandbox();
    let repo = sample_repository(&sandbox.root, "sample");
    let registry = Registry::new(Store::new(&sandbox.root.join("config")));
    registry.add_folder(&git_path(&repo)).unwrap();
    let default = registry
        .worktree_folder(&git_path(&repo), None, "sample-side")
        .unwrap();
    assert_eq!(default, sandbox.root.join("sample-side"));
    let parent = sandbox.root.join("trees");
    std::fs::create_dir_all(&parent).unwrap();
    let token = registry.remember_parent(parent.clone());
    let chosen = registry
        .worktree_folder(&git_path(&repo), Some(&token), "side")
        .unwrap();
    assert_eq!(chosen, parent.join("side"));
    assert!(registry
        .worktree_folder(&git_path(&repo), Some("made-up"), "side")
        .is_err());
    assert!(registry
        .worktree_folder(&git_path(&repo), None, "../escape")
        .is_err());
}

#[test]
fn a_project_added_while_projects_are_read_is_listed() {
    let sandbox = sandbox();
    let first = sample_repository(&sandbox.root, "first");
    let second = sample_repository(&sandbox.root, "second");
    let registry = Registry::new(Store::new(&sandbox.root.join("config")));
    registry.add_folder(&git_path(&first)).unwrap();
    let stale = registry.preferences().projects;
    let resolved = ratelgit_lib::projects::resolve_all(&stale);
    registry.add_folder(&git_path(&second)).unwrap();
    let listed = registry.finish_listing(&stale, &resolved).unwrap();
    let names: Vec<_> = listed.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, vec!["first", "second"]);
}
