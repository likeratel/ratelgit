//! ratelgit core: runs the local Git CLI for the web UI. See `CONTRACT.md`.

mod commands;
pub mod error;
pub mod git;
pub mod projects;
pub mod snapshot;
pub mod store;

use std::sync::Arc;

use tauri::Manager;

use crate::projects::Registry;
use crate::store::Store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let directory = app.path().app_config_dir()?;
            app.manage(Arc::new(Registry::new(Store::new(&directory))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_bootstrap,
            commands::list_projects,
            commands::add_project,
            commands::remove_project,
            commands::list_worktrees,
            commands::load_worktree,
            commands::load_history,
            commands::load_commit,
            commands::load_diff,
            commands::run_action,
            commands::save_preferences,
            commands::load_conflict,
            commands::open_file,
            commands::choose_worktree_parent,
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        log::error!("ratelgit failed to start: {error}");
        eprintln!("ratelgit failed to start: {error}");
        std::process::exit(1);
    }
}
