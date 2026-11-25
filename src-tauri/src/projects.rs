//! Registered projects and the worktrees they own. Every command that runs Git in a folder
//! first asks the registry whether that folder is a worktree of a registered project.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::thread;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::git::{folder_name, Git, Worktree};
use crate::store::{unique, Preferences, Store, UiPreferences};

const MAX_PATH_LENGTH: usize = 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectState {
    Ready,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    /// Main worktree path, or the stored path when it could not be resolved.
    pub path: String,
    pub name: String,
    pub state: ProjectState,
    /// Why the project is unavailable.
    pub reason: Option<String>,
    pub worktrees: Vec<Worktree>,
}

/// A new worktree checked before it is created.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreePlan {
    /// The folder the worktree would be created in, when the name is usable.
    pub path: Option<String>,
    pub folder_error: Option<String>,
    pub branch_error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddedProject {
    pub projects: Vec<Project>,
    /// Worktree to select: the one containing the chosen folder when possible.
    pub worktree: Option<String>,
}

/// A worktree path as Git reports it, with its canonical form for comparisons.
#[derive(Clone, Debug)]
struct Known {
    reported: String,
    canonical: PathBuf,
}

pub struct Registry {
    store: Store,
    preferences: Mutex<Preferences>,
    worktrees: Mutex<HashMap<String, Vec<Known>>>,
    /// Folders picked for new worktrees, by token.
    parents: Mutex<HashMap<String, PathBuf>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panic while holding the lock leaves plain data behind; keep using it.
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Canonical form used to compare paths that may differ by symlinks, case or separators.
fn canonical(path: &str) -> Option<PathBuf> {
    dunce::canonicalize(path).ok()
}

fn same_path(left: &str, right: &str) -> bool {
    left == right || matches!((canonical(left), canonical(right)), (Some(a), Some(b)) if a == b)
}

fn validate_path(path: &str) -> AppResult<()> {
    if path.is_empty() || path.len() > MAX_PATH_LENGTH || path.contains('\0') {
        return Err(AppError::invalid("Invalid folder path."));
    }
    Ok(())
}

/// Reads one stored project. Missing folders and Git errors make it unavailable, not fail.
pub fn resolve_project(path: &str) -> Project {
    let unavailable = |reason: String| Project {
        path: path.to_string(),
        name: folder_name(path),
        state: ProjectState::Unavailable,
        reason: Some(reason),
        worktrees: Vec::new(),
    };
    if !Path::new(path).is_dir() {
        return unavailable("Folder not found".to_string());
    }
    match Git::new(path).worktrees() {
        Ok(worktrees) if !worktrees.is_empty() => {
            let main = worktrees[0].path.clone();
            Project {
                name: folder_name(&main),
                path: main,
                state: ProjectState::Ready,
                reason: None,
                worktrees,
            }
        }
        Ok(_) => unavailable("This folder has no Git worktree.".to_string()),
        Err(error) => unavailable(error.message),
    }
}

/// Resolves stored project paths in parallel, in order.
pub fn resolve_all(paths: &[String]) -> Vec<Project> {
    thread::scope(|scope| {
        let handles: Vec<_> = paths
            .iter()
            .map(|path| scope.spawn(move || resolve_project(path)))
            .collect();
        handles
            .into_iter()
            .zip(paths)
            .map(|(handle, path)| handle.join().unwrap_or_else(|_| resolve_failed(path)))
            .collect()
    })
}

impl Registry {
    pub fn new(store: Store) -> Self {
        let preferences = store.load();
        Self {
            store,
            preferences: Mutex::new(preferences),
            worktrees: Mutex::new(HashMap::new()),
            parents: Mutex::new(HashMap::new()),
        }
    }

    /// Keeps a folder picked in the native dialog and returns a token the UI can send back.
    /// The UI never sends a folder path itself.
    pub fn remember_parent(&self, folder: PathBuf) -> String {
        let mut parents = lock(&self.parents);
        let token = format!("parent-{}", parents.len() + 1);
        parents.insert(token.clone(), folder);
        token
    }

    /// Folder for a new worktree of the project owning `worktree`: `name` inside the folder
    /// picked earlier (`parent` token), or inside the folder that contains the project.
    pub fn worktree_folder(
        &self,
        worktree: &str,
        parent: Option<&str>,
        name: &str,
    ) -> AppResult<PathBuf> {
        let base = match parent {
            Some(token) => lock(&self.parents).get(token).cloned().ok_or_else(|| {
                AppError::invalid("Choose the folder for the new worktree again.")
            })?,
            None => self
                .main_worktree(worktree)?
                .parent()
                .map(Path::to_path_buf)
                .ok_or_else(|| AppError::invalid("The project folder has no parent folder."))?,
        };
        crate::git::child_folder(&base, name)
    }

    /// Where a new worktree would go and what is wrong with the names so far.
    pub fn plan_worktree(
        &self,
        worktree: &str,
        parent: Option<&str>,
        folder: &str,
        new_branch: Option<&str>,
    ) -> AppResult<WorktreePlan> {
        let git = Git::new(self.resolve_worktree(worktree)?);
        let (path, folder_error) = match self.worktree_folder(worktree, parent, folder) {
            Ok(path) => {
                let filled = std::fs::read_dir(&path).is_ok_and(|mut e| e.next().is_some());
                let error = (filled || path.is_file()).then(|| {
                    "A folder with this name already exists and is not empty.".to_string()
                });
                (Some(path.to_string_lossy().into_owned()), error)
            }
            Err(error) => (None, Some(error.message)),
        };
        let branch_error =
            new_branch.and_then(|name| git.check_new_branch(name).err().map(|e| e.message));
        Ok(WorktreePlan {
            path,
            folder_error,
            branch_error,
        })
    }

    /// Removes `target` through the project of `worktree`.
    pub fn remove_worktree(
        &self,
        worktree: &str,
        target: &str,
        options: &crate::git::RemoveOptions,
    ) -> AppResult<crate::git::RemovalResult> {
        let main = self.main_worktree(worktree)?;
        let result = Git::new(&main).remove_worktree(target, options)?;
        // The removal is done. Re-reading the list is housekeeping: it goes through the
        // worktree the request came from (the main folder may be a bare repository), and a
        // failure there must not turn the successful removal into an error.
        let anchor = if worktree == target {
            main.to_string_lossy().into_owned()
        } else {
            worktree.to_string()
        };
        if let Err(error) = self.project_worktrees(&anchor) {
            log::warn!(
                "re-reading worktrees after a removal failed: {}",
                error.message
            );
        }
        Ok(result)
    }

    /// The main worktree of the project that owns `worktree` (a registered worktree).
    pub fn main_worktree(&self, worktree: &str) -> AppResult<PathBuf> {
        let folder = self.resolve_worktree(worktree)?;
        Git::new(&folder)
            .worktrees()?
            .first()
            .map(|t| PathBuf::from(&t.path))
            .ok_or_else(|| AppError::not_found("The project has no main worktree."))
    }

    pub fn preferences(&self) -> Preferences {
        lock(&self.preferences).clone()
    }

    fn update(&self, change: impl FnOnce(Preferences) -> Preferences) -> AppResult<Preferences> {
        let mut current = lock(&self.preferences);
        let next = change(current.clone()).sanitized();
        if next != *current {
            self.store.save(&next)?;
            *current = next.clone();
        }
        Ok(next)
    }

    fn remember(&self, projects: &[Project]) {
        let mut known = lock(&self.worktrees);
        for project in projects {
            let entries = project
                .worktrees
                .iter()
                .filter(|tree| !tree.unavailable)
                .filter_map(|tree| {
                    canonical(&tree.path).map(|canonical| Known {
                        reported: tree.path.clone(),
                        canonical,
                    })
                })
                .collect();
            known.insert(project.path.clone(), entries);
        }
    }

    /// Resolves every stored project in parallel. Paths of one repository's worktrees saved
    /// earlier collapse into one project, and the list is saved back.
    pub fn list_projects(&self) -> AppResult<Vec<Project>> {
        let paths = self.preferences().projects;
        let resolved = resolve_all(&paths);
        self.finish_listing(&paths, &resolved)
    }

    /// Records projects resolved from `paths`. The stored list may have changed meanwhile:
    /// projects removed since are left out, projects added since are kept.
    pub fn finish_listing(
        &self,
        paths: &[String],
        resolved: &[Project],
    ) -> AppResult<Vec<Project>> {
        let mut current = Vec::new();
        self.update(|preferences| {
            let projects: Vec<String> = preferences
                .projects
                .iter()
                .map(|stored| {
                    paths
                        .iter()
                        .position(|p| p == stored)
                        .map_or_else(|| stored.clone(), |at| resolved[at].path.clone())
                })
                .collect();
            current = unique(projects.clone());
            Preferences {
                projects,
                ..preferences
            }
        })?;
        // Projects added while the list was being read are resolved now, so they stay listed.
        let projects: Vec<Project> = current
            .iter()
            .map(|path| {
                resolved
                    .iter()
                    .find(|p| &p.path == path)
                    .cloned()
                    .unwrap_or_else(|| resolve_project(path))
            })
            .collect();
        self.remember(&projects);
        Ok(projects)
    }

    /// Adds the repository containing `folder`, or refreshes it if it is already listed.
    pub fn add_folder(&self, folder: &str) -> AppResult<AddedProject> {
        validate_path(folder)?;
        let git = Git::new(folder);
        let worktrees = git.worktrees().map_err(|error| {
            AppError::not_found(format!(
                "This folder is not a Git repository. {}",
                error.message
            ))
        })?;
        let main = worktrees
            .first()
            .map(|tree| tree.path.clone())
            .ok_or_else(|| AppError::not_found("This folder has no Git worktree."))?;
        let root = git.worktree_root().ok();
        let wanted = root
            .as_deref()
            .and_then(|root| {
                worktrees
                    .iter()
                    .find(|t| !t.unavailable && same_path(&t.path, root))
            })
            .or_else(|| worktrees.iter().find(|t| !t.unavailable))
            .map(|tree| tree.path.clone());
        self.update(|preferences| {
            let projects = merge_project(preferences.projects, &main, &worktrees);
            Preferences {
                projects,
                ..preferences
            }
        })?;
        Ok(AddedProject {
            projects: self.list_projects()?,
            worktree: wanted,
        })
    }

    pub fn remove(&self, path: &str) -> AppResult<Vec<String>> {
        validate_path(path)?;
        lock(&self.worktrees).remove(path);
        let next = self.update(|preferences| Preferences {
            projects: preferences
                .projects
                .into_iter()
                .filter(|p| p != path)
                .collect(),
            ..preferences
        })?;
        Ok(next.projects)
    }

    /// Validated folder to run Git in. Fails unless `path` is an available worktree of a
    /// registered project; the worktree lists are re-read once before giving up.
    pub fn resolve_worktree(&self, path: &str) -> AppResult<PathBuf> {
        validate_path(path)?;
        let target = canonical(path)
            .ok_or_else(|| AppError::not_found("The worktree folder no longer exists."))?;
        if let Some(found) = self.find(&target) {
            return Ok(found);
        }
        self.refresh_known();
        self.find(&target).ok_or_else(|| {
            AppError::not_found("This folder is not a worktree of a project in the sidebar.")
        })
    }

    /// Worktrees of the project that owns `worktree`, re-read from Git.
    pub fn project_worktrees(&self, worktree: &str) -> AppResult<Vec<Worktree>> {
        let folder = self.resolve_worktree(worktree)?;
        let worktrees = Git::new(&folder).worktrees()?;
        let main = worktrees
            .first()
            .map(|t| t.path.clone())
            .unwrap_or_default();
        let project = Project {
            name: folder_name(&main),
            path: main,
            state: ProjectState::Ready,
            reason: None,
            worktrees: worktrees.clone(),
        };
        self.remember(&[project]);
        Ok(worktrees)
    }

    pub fn save_preferences(
        &self,
        filters: BTreeMap<String, Vec<String>>,
        ui: UiPreferences,
    ) -> AppResult<Preferences> {
        self.update(|preferences| Preferences {
            filters,
            ui,
            ..preferences
        })
    }

    fn find(&self, target: &Path) -> Option<PathBuf> {
        let registered = self.preferences().projects;
        let known = lock(&self.worktrees);
        known
            .iter()
            .filter(|(project, _)| registered.contains(project))
            .flat_map(|(_, entries)| entries)
            .find(|entry| entry.canonical == target)
            .map(|entry| PathBuf::from(&entry.reported))
    }

    fn refresh_known(&self) {
        let paths = self.preferences().projects;
        let projects: Vec<Project> = paths.iter().map(|path| light_project(path)).collect();
        self.remember(&projects);
    }
}

fn resolve_failed(path: &str) -> Project {
    log::error!("resolving project {path} panicked");
    Project {
        path: path.to_string(),
        name: folder_name(path),
        state: ProjectState::Unavailable,
        reason: Some("Reading this project failed.".to_string()),
        worktrees: Vec::new(),
    }
}

/// A project with its worktree list only, for validating paths.
fn light_project(path: &str) -> Project {
    let resolved = resolve_project(path);
    Project {
        path: path.to_string(),
        ..resolved
    }
}

/// Keeps the list order: replaces this repository's entries (main or any of its worktrees)
/// with its main path, or appends it.
fn merge_project(projects: Vec<String>, main: &str, worktrees: &[Worktree]) -> Vec<String> {
    let belongs = |candidate: &str| {
        candidate == main || worktrees.iter().any(|t| same_path(&t.path, candidate))
    };
    let position = projects.iter().position(|p| belongs(p));
    let mut kept: Vec<String> = projects.into_iter().filter(|p| !belongs(p)).collect();
    match position {
        Some(index) => kept.insert(index.min(kept.len()), main.to_string()),
        None => kept.push(main.to_string()),
    }
    unique(kept)
}
