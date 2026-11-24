//! Commands invoked by the web UI (see `CONTRACT.md`).
//!
//! Every Git call runs on the blocking pool so the UI thread never waits on Git. Arguments
//! that need validation arrive as raw JSON so a malformed value is rejected with an
//! `AppError` rather than a bare deserialization string.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};
use crate::git::{
    is_unc, Action, ChangedFile, CommitInfo, ConflictDocument, FileDiff, Git, HistoryPage,
    OpenDecision, Scope, Worktree,
};
use crate::git::{validate, HISTORY_PAGE_SIZE};
use crate::projects::{AddedProject, Project, Registry};
use crate::snapshot::{self, WorktreeSnapshot};
use crate::store::{Preferences, UiPreferences};

type Shared<'a> = State<'a, Arc<Registry>>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    preferences: Preferences,
    platform: &'static str,
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    }
}

fn parse<T: DeserializeOwned>(value: Value, what: &str) -> AppResult<T> {
    serde_json::from_value(value).map_err(|error| AppError::invalid(format!("{what}: {error}")))
}

/// Runs `work` on the blocking pool.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| {
            log::error!("background task failed: {error}");
            AppError::io("The operation stopped unexpectedly.")
        })?
}

/// Runs `work` with a Git client for a validated worktree.
async fn in_worktree<T: Send + 'static>(
    registry: &Arc<Registry>,
    worktree: String,
    work: impl FnOnce(Git) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let registry = Arc::clone(registry);
    blocking(move || {
        let folder = registry.resolve_worktree(&worktree)?;
        work(Git::new(folder))
    })
    .await
}

#[tauri::command]
pub async fn get_bootstrap(registry: Shared<'_>) -> AppResult<Bootstrap> {
    Ok(Bootstrap {
        preferences: registry.preferences(),
        platform: platform(),
    })
}

#[tauri::command]
pub async fn list_projects(registry: Shared<'_>) -> AppResult<Vec<Project>> {
    let registry = Arc::clone(&registry);
    blocking(move || registry.list_projects()).await
}

/// Shows a native folder picker and adds the repository that contains the chosen folder.
/// Returns `null` when the user cancels.
#[tauri::command]
pub async fn add_project(app: AppHandle, registry: Shared<'_>) -> AppResult<Option<AddedProject>> {
    let registry = Arc::clone(&registry);
    blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_title("Choose a Git repository or worktree folder")
            .blocking_pick_folder();
        let Some(picked) = picked else {
            return Ok(None);
        };
        let folder = picked
            .into_path()
            .map_err(|_| AppError::invalid("Choose a folder on this computer."))?;
        let folder = folder
            .to_str()
            .ok_or_else(|| AppError::invalid("The folder path is not valid Unicode."))?
            .to_string();
        registry.add_folder(&folder).map(Some)
    })
    .await
}

#[tauri::command]
pub async fn remove_project(registry: Shared<'_>, path: String) -> AppResult<Vec<String>> {
    let registry = Arc::clone(&registry);
    blocking(move || registry.remove(&path)).await
}

#[tauri::command]
pub async fn list_worktrees(registry: Shared<'_>, worktree: String) -> AppResult<Vec<Worktree>> {
    let registry = Arc::clone(&registry);
    blocking(move || registry.project_worktrees(&worktree)).await
}

#[tauri::command]
pub async fn load_worktree(
    registry: Shared<'_>,
    worktree: String,
    filter: Vec<String>,
) -> AppResult<WorktreeSnapshot> {
    validate::filter_refs(&filter)?;
    in_worktree(&registry, worktree, move |git| {
        snapshot::load(&git, &filter)
    })
    .await
}

#[tauri::command]
pub async fn load_history(
    registry: Shared<'_>,
    worktree: String,
    filter: Vec<String>,
    skip: usize,
) -> AppResult<HistoryPage> {
    validate::filter_refs(&filter)?;
    in_worktree(&registry, worktree, move |git| {
        git.history(&Scope(filter), skip, HISTORY_PAGE_SIZE)
    })
    .await
}

#[tauri::command]
pub async fn load_commit(
    registry: Shared<'_>,
    worktree: String,
    hash: String,
) -> AppResult<CommitInfo> {
    validate::hash(&hash)?;
    in_worktree(&registry, worktree, move |git| {
        Ok(CommitInfo {
            detail: git.commit_detail(&hash)?,
            files: git.commit_files(&hash)?,
        })
    })
    .await
}

#[tauri::command]
pub async fn load_diff(
    registry: Shared<'_>,
    worktree: String,
    file: Value,
    commit: Option<String>,
    ignore_whitespace: bool,
) -> AppResult<FileDiff> {
    let file: ChangedFile = parse(file, "Invalid file")?;
    validate::relative_path(&file.path)?;
    if let Some(commit) = &commit {
        validate::hash(commit)?;
    }
    in_worktree(&registry, worktree, move |git| {
        git.diff(&file, commit.as_deref(), ignore_whitespace)
    })
    .await
}

#[tauri::command]
pub async fn run_action(registry: Shared<'_>, worktree: String, action: Value) -> AppResult<()> {
    let action: Action = parse(action, "Invalid action")?;
    let registry = Arc::clone(&registry);
    blocking(move || {
        let folder = registry.resolve_worktree(&worktree)?;
        let git = Git::new(folder);
        match &action {
            // The folder is built in the core from a picked folder and a plain name.
            Action::AddWorktree {
                reference,
                parent,
                name,
            } => {
                let location = registry.worktree_folder(&worktree, parent.as_deref(), name)?;
                git.add_worktree(reference, &location)
            }
            _ => git.execute(&action),
        }
    })
    .await
}

#[tauri::command]
pub async fn save_preferences(
    registry: Shared<'_>,
    filters: Value,
    ui: Value,
) -> AppResult<Preferences> {
    let filters: BTreeMap<String, Vec<String>> = parse(filters, "Invalid filters")?;
    let ui: UiPreferences = parse(ui, "Invalid settings")?;
    filters
        .values()
        .try_for_each(|refs| validate::filter_refs(refs))?;
    let registry = Arc::clone(&registry);
    blocking(move || registry.save_preferences(filters, ui)).await
}

#[tauri::command]
pub async fn load_conflict(
    registry: Shared<'_>,
    worktree: String,
    path: String,
) -> AppResult<ConflictDocument> {
    validate::relative_path(&path)?;
    in_worktree(&registry, worktree, move |git| git.load_conflict(&path)).await
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OpenAction {
    Opened,
    Revealed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    action: OpenAction,
}

/// Opens a conflicted file in its default app, or only reveals it in the file manager when
/// opening could run it. See `Git::open_decision`.
#[tauri::command]
pub async fn open_file(
    app: AppHandle,
    registry: Shared<'_>,
    worktree: String,
    path: String,
) -> AppResult<OpenResult> {
    validate::relative_path(&path)?;
    in_worktree(&registry, worktree, move |git| {
        let failed = |error: tauri_plugin_opener::Error| {
            log::error!("opening a file failed: {error}");
            AppError::io("The file could not be opened.")
        };
        match git.open_decision(&path)? {
            OpenDecision::Open(file) => {
                let target = file.to_string_lossy().into_owned();
                app.opener()
                    .open_path(target, None::<&str>)
                    .map_err(failed)?;
                Ok(OpenResult {
                    action: OpenAction::Opened,
                })
            }
            OpenDecision::Reveal(file) => {
                app.opener().reveal_item_in_dir(file).map_err(failed)?;
                Ok(OpenResult {
                    action: OpenAction::Revealed,
                })
            }
        }
    })
    .await
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChosenParent {
    /// Sent back in `addWorktree`; the folder path itself never comes from the UI.
    token: String,
    /// For display only.
    path: String,
}

/// Shows a native folder picker for the folder that will hold a new worktree. `null` when
/// cancelled.
#[tauri::command]
pub async fn choose_worktree_parent(
    app: AppHandle,
    registry: Shared<'_>,
) -> AppResult<Option<ChosenParent>> {
    let registry = Arc::clone(&registry);
    blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_title("Choose the folder for the new worktree")
            .blocking_pick_folder();
        let Some(picked) = picked else {
            return Ok(None);
        };
        let folder = picked
            .into_path()
            .map_err(|_| AppError::invalid("Choose a folder on this computer."))?;
        if !folder.is_absolute() || is_unc(&folder) {
            return Err(AppError::invalid("Choose a folder on a local drive."));
        }
        let path = folder.to_string_lossy().into_owned();
        Ok(Some(ChosenParent {
            token: registry.remember_parent(folder),
            path,
        }))
    })
    .await
}
