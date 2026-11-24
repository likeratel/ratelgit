//! App preferences persisted as JSON in the app config folder: the project list, each
//! project's history filter and a few layout choices.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::git::validate;

pub const FILE_NAME: &str = "ratelgit.json";
/// 2: an empty filter list means "show every branch"; a project without an entry uses the
/// default filter. In version 1 an empty list meant "no filter chosen" and reads as default.
const VERSION: u32 = 2;
const MAX_PROJECTS: usize = 500;
pub const SIDEBAR_WIDTH: (u32, u32, u32) = (220, 272, 420);
pub const SPLIT_RANGE: (f64, f64) = (0.2, 0.8);
const DEFAULT_HISTORY_SPLIT: f64 = 0.55;
const DEFAULT_CHANGES_SPLIT: f64 = 0.4;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffLayout {
    #[default]
    Unified,
    Split,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UiPreferences {
    pub diff_layout: DiffLayout,
    pub ignore_whitespace: bool,
    pub sidebar_width: u32,
    /// Share of the History area given to the commit list; the detail panel gets the rest.
    pub history_split: f64,
    /// Share of the Changes area given to the file list; the diff gets the rest.
    pub changes_split: f64,
    /// Worktree to reopen at launch.
    pub last_worktree: Option<String>,
}

impl Default for UiPreferences {
    fn default() -> Self {
        Self {
            diff_layout: DiffLayout::Unified,
            ignore_whitespace: false,
            sidebar_width: SIDEBAR_WIDTH.1,
            history_split: DEFAULT_HISTORY_SPLIT,
            changes_split: DEFAULT_CHANGES_SPLIT,
            last_worktree: None,
        }
    }
}

impl UiPreferences {
    /// Clamps sizes into range and drops an unusable last-worktree value.
    pub fn sanitized(self) -> Self {
        let split = |value: f64, fallback: f64| match value.is_finite() {
            true => value.clamp(SPLIT_RANGE.0, SPLIT_RANGE.1),
            false => fallback,
        };
        Self {
            sidebar_width: self.sidebar_width.clamp(SIDEBAR_WIDTH.0, SIDEBAR_WIDTH.2),
            history_split: split(self.history_split, DEFAULT_HISTORY_SPLIT),
            changes_split: split(self.changes_split, DEFAULT_CHANGES_SPLIT),
            last_worktree: self
                .last_worktree
                .filter(|path| !path.is_empty() && path.len() < 4096 && !path.contains('\0')),
            ..self
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub version: u32,
    /// Main worktree paths of the projects in the sidebar, in display order.
    pub projects: Vec<String>,
    /// History filter per project path: full ref names or `HEAD`. A project without an entry
    /// uses the default filter; an empty list shows every branch.
    pub filters: BTreeMap<String, Vec<String>>,
    pub ui: UiPreferences,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            version: VERSION,
            projects: Vec::new(),
            filters: BTreeMap::new(),
            ui: UiPreferences::default(),
        }
    }
}

impl Preferences {
    /// Removes duplicate or empty project paths, filters of unknown projects and invalid refs.
    pub fn sanitized(self) -> Self {
        let projects = unique(self.projects);
        let filters = self
            .filters
            .into_iter()
            .filter(|(project, _)| projects.contains(project))
            .filter(|(_, refs)| validate::filter_refs(refs).is_ok())
            .collect();
        Self {
            version: VERSION,
            projects,
            filters,
            ui: self.ui.sanitized(),
        }
    }
}

pub fn unique(paths: Vec<String>) -> Vec<String> {
    paths.into_iter().fold(Vec::new(), |mut result, path| {
        if !path.is_empty() && !result.contains(&path) && result.len() < MAX_PROJECTS {
            result.push(path);
        }
        result
    })
}

fn pick<T: serde::de::DeserializeOwned>(
    ui: Option<&serde_json::Map<String, serde_json::Value>>,
    name: &str,
) -> Option<T> {
    let value = ui?.get(name)?.clone();
    serde_json::from_value(value).ok()
}

/// Reads each field on its own, so a field written by a later version, or one with a wrong
/// type, falls back to its default without losing the project list.
fn from_value(value: &serde_json::Value) -> Preferences {
    let strings = |value: &serde_json::Value| -> Vec<String> {
        value
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|i| i.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    };
    let version = value.get("version").and_then(|v| v.as_u64()).unwrap_or(1);
    let filters = value
        .get("filters")
        .and_then(|f| f.as_object())
        .map(|map| {
            map.iter()
                .map(|(k, v)| (k.clone(), strings(v)))
                // Version 1 stored "no filter chosen" as an empty list: that is the default now.
                .filter(|(_, refs)| version >= 2 || !refs.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let defaults = UiPreferences::default();
    let ui = value.get("ui").and_then(|ui| ui.as_object());
    Preferences {
        version: VERSION,
        projects: value.get("projects").map(strings).unwrap_or_default(),
        filters,
        ui: UiPreferences {
            diff_layout: pick(ui, "diffLayout").unwrap_or(defaults.diff_layout),
            ignore_whitespace: pick(ui, "ignoreWhitespace").unwrap_or(defaults.ignore_whitespace),
            sidebar_width: pick(ui, "sidebarWidth").unwrap_or(defaults.sidebar_width),
            history_split: pick(ui, "historySplit").unwrap_or(defaults.history_split),
            changes_split: pick(ui, "changesSplit").unwrap_or(defaults.changes_split),
            last_worktree: pick(ui, "lastWorktree").unwrap_or(defaults.last_worktree),
        },
    }
}

/// Reads and writes the preferences file.
pub struct Store {
    file: PathBuf,
}

impl Store {
    pub fn new(directory: &Path) -> Self {
        Self {
            file: directory.join(FILE_NAME),
        }
    }

    /// Loads the file. A missing file gives defaults; an unreadable one is set aside as
    /// `.corrupt` so it is not overwritten, and defaults are used.
    pub fn load(&self) -> Preferences {
        let text = match fs::read_to_string(&self.file) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Preferences::default()
            }
            Err(error) => {
                log::error!("reading {}: {error}", self.file.display());
                return Preferences::default();
            }
        };
        match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(value) => from_value(&value).sanitized(),
            Err(error) => {
                log::error!("preferences file is invalid: {error}");
                let backup = self.file.with_extension("json.corrupt");
                if let Err(error) = fs::rename(&self.file, backup) {
                    log::error!("setting aside the invalid preferences failed: {error}");
                }
                Preferences::default()
            }
        }
    }

    /// Writes through a temporary file so a crash never leaves a half-written file.
    pub fn save(&self, preferences: &Preferences) -> AppResult<()> {
        let failed = |error: &dyn std::fmt::Display| {
            log::error!("saving preferences: {error}");
            AppError::io("Your project list and settings could not be saved.")
        };
        if let Some(parent) = self.file.parent() {
            fs::create_dir_all(parent).map_err(|e| failed(&e))?;
        }
        let text = serde_json::to_string_pretty(preferences).map_err(|e| failed(&e))?;
        let temporary = self.file.with_extension("json.tmp");
        fs::write(&temporary, text).map_err(|e| failed(&e))?;
        fs::rename(&temporary, &self.file).map_err(|e| failed(&e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizing_drops_duplicates_and_unknown_filters() {
        let preferences = Preferences {
            projects: vec!["/b".into(), "/c".into(), "/b".into(), String::new()],
            filters: BTreeMap::from([
                ("/b".to_string(), vec!["refs/heads/x".to_string()]),
                ("/gone".to_string(), vec!["HEAD".to_string()]),
                ("/c".to_string(), vec!["--all".to_string()]),
            ]),
            ui: UiPreferences {
                sidebar_width: 9999,
                history_split: f64::NAN,
                ..UiPreferences::default()
            },
            ..Preferences::default()
        }
        .sanitized();
        assert_eq!(preferences.projects, vec!["/b", "/c"]);
        assert_eq!(preferences.filters.keys().collect::<Vec<_>>(), vec!["/b"]);
        assert_eq!(preferences.ui.sidebar_width, SIDEBAR_WIDTH.2);
        assert_eq!(preferences.ui.history_split, DEFAULT_HISTORY_SPLIT);
    }

    #[test]
    fn round_trips_and_sets_aside_corrupt_files() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::new(directory.path());
        assert_eq!(store.load(), Preferences::default());
        let saved = Preferences {
            projects: vec!["/a".into()],
            ..Preferences::default()
        };
        store.save(&saved).unwrap();
        assert_eq!(store.load(), saved);
        fs::write(directory.path().join(FILE_NAME), "{ not json").unwrap();
        assert_eq!(store.load(), Preferences::default());
        assert!(directory.path().join("ratelgit.json.corrupt").exists());
    }
}
