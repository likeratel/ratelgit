//! Conflicted files: reading them as chunks for the viewer and resolving them.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::markers::{self, ChunkChoice, Segment};
use super::models::{ChangeKind, ChangedFile};
use super::runner::{Git, RunOptions};
use super::validate;
use crate::error::{AppError, AppResult, ErrorKind};

/// How much of the start of a file is checked for NUL bytes.
const BINARY_SNIFF: usize = 8000;
/// Files above this size are resolved as a whole only.
const MAX_CONFLICT_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictKind {
    BothModified,
    BothAdded,
    BothDeleted,
    AddedByUs,
    AddedByThem,
    DeletedByUs,
    DeletedByThem,
}

impl ConflictKind {
    /// Unmerged `XY` codes from `git status --porcelain`.
    pub fn from_code(code: &str) -> Option<Self> {
        Some(match code {
            "UU" => Self::BothModified,
            "AA" => Self::BothAdded,
            "DD" => Self::BothDeleted,
            "AU" => Self::AddedByUs,
            "UA" => Self::AddedByThem,
            "DU" => Self::DeletedByUs,
            "UD" => Self::DeletedByThem,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Ours,
    Theirs,
}

/// Result of checking a file for "Open".
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OpenDecision {
    Open(PathBuf),
    Reveal(PathBuf),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DocumentState {
    /// Parsed into chunks; choose a side per chunk.
    Ready,
    /// No conflict markers are left; mark the file resolved or edit it.
    NoMarkers,
    /// Markers are nested or unbalanced; resolve by hand.
    Malformed,
    Binary,
    NotUtf8,
    TooLarge,
    /// The file is not in the work tree (deleted on one or both sides).
    Missing,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictDocument {
    pub path: String,
    pub state: DocumentState,
    /// Explanation for states other than `ready`.
    pub reason: Option<String>,
    /// Identifies the bytes that were read; saving fails if the file changed since.
    pub fingerprint: Option<String>,
    /// Lines keep their terminators (`\n` or `\r\n`).
    pub segments: Vec<Segment>,
}

impl Git {
    /// Absolute path of a repository-relative file, refused if it leaves the worktree or is a
    /// symbolic link.
    pub fn file_in_worktree(&self, relative: &str) -> AppResult<PathBuf> {
        validate::relative_path(relative)?;
        let root = dunce::canonicalize(self.path())
            .map_err(|_| AppError::not_found("The worktree folder no longer exists."))?;
        let path = root.join(relative);
        let parent = path.parent().and_then(|p| dunce::canonicalize(p).ok());
        let inside = parent.is_some_and(|p| p.starts_with(&root));
        let link = fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink());
        if !inside || link {
            return Err(AppError::invalid(
                "This file is outside the worktree or is a link.",
            ));
        }
        Ok(path)
    }

    /// Reads a file that is conflicted right now; anything else is refused.
    pub fn load_conflict(&self, relative: &str) -> AppResult<ConflictDocument> {
        let path = self.file_in_worktree(relative)?;
        self.expect_conflicted_path(relative)?;
        let document =
            |state, reason: &str, fingerprint: Option<String>, segments| ConflictDocument {
                path: relative.to_string(),
                state,
                reason: (!reason.is_empty()).then(|| reason.to_string()),
                fingerprint,
                segments,
            };
        let Ok(metadata) = fs::metadata(&path) else {
            return Ok(document(
                DocumentState::Missing,
                "The file is not in the work tree.",
                None,
                vec![],
            ));
        };
        if metadata.len() > MAX_CONFLICT_BYTES {
            return Ok(document(
                DocumentState::TooLarge,
                "The file is too large to show by chunk.",
                None,
                vec![],
            ));
        }
        let bytes = read_file(&path)?;
        let fingerprint = Some(markers::fingerprint(&bytes));
        if bytes.iter().take(BINARY_SNIFF).any(|b| *b == 0) {
            return Ok(document(
                DocumentState::Binary,
                "Binary file.",
                fingerprint,
                vec![],
            ));
        }
        let Ok(text) = String::from_utf8(bytes) else {
            return Ok(document(
                DocumentState::NotUtf8,
                "The file is not UTF-8 text.",
                fingerprint,
                vec![],
            ));
        };
        let base_markers = self.base_markers()?;
        Ok(match markers::parse(&text, base_markers) {
            Err(reason) => document(DocumentState::Malformed, &reason, fingerprint, vec![]),
            Ok(segments) if markers::conflict_count(&segments) == 0 => document(
                DocumentState::NoMarkers,
                "No conflict markers are left in the file.",
                fingerprint,
                segments,
            ),
            Ok(segments) => document(DocumentState::Ready, "", fingerprint, segments),
        })
    }

    fn expect_conflicted_path(&self, relative: &str) -> AppResult<()> {
        let listed = self
            .working_files()?
            .iter()
            .any(|f| f.path == relative && f.is_conflicted());
        if !listed {
            return Err(AppError::stale(
                "The file is not conflicted. Refresh and try again.",
            ));
        }
        Ok(())
    }

    /// Whether conflicts in this worktree are written with a base section (`diff3`, `zdiff3`).
    fn base_markers(&self) -> AppResult<bool> {
        let style = self.run(
            &["config", "--get", "merge.conflictStyle"],
            RunOptions::accepting(&[0, 1]),
        )?;
        Ok(matches!(style.trim(), "diff3" | "zdiff3"))
    }

    /// What "Open" does with a conflicted file: open it in its default app, or only reveal it
    /// in the file manager when opening could run it (scripts, programs, shortcuts).
    pub fn open_decision(&self, relative: &str) -> AppResult<OpenDecision> {
        validate::relative_path(relative)?;
        if relative
            .split('/')
            .any(|part| part.eq_ignore_ascii_case(".git"))
        {
            return Err(AppError::invalid("Files inside .git are not opened."));
        }
        let path = self.file_in_worktree(relative)?;
        self.expect_conflicted_path(relative)?;
        if !path.is_file() {
            return Err(AppError::not_found("The file is not in the work tree."));
        }
        Ok(if runnable(&path) {
            OpenDecision::Reveal(path)
        } else {
            OpenDecision::Open(path)
        })
    }

    fn expect_conflicted(&self, file: &ChangedFile) -> AppResult<()> {
        let current = self.working_files()?;
        let listed = current
            .iter()
            .any(|f| f.path == file.path && f.is_conflicted());
        if file.kind != ChangeKind::Unstaged || !file.is_conflicted() || !listed {
            return Err(AppError::stale(
                "The file is no longer conflicted. Refresh and try again.",
            ));
        }
        Ok(())
    }

    /// Takes the whole file from one side, or removes it if that side deleted it.
    pub(super) fn resolve_side(&self, file: &ChangedFile, side: Side) -> AppResult<()> {
        self.expect_conflicted(file)?;
        let stage = match side {
            Side::Ours => "2",
            Side::Theirs => "3",
        };
        let stages = self.run(
            &["ls-files", "-u", "-z", "--", &file.path],
            RunOptions::default().literal(),
        )?;
        let present = stages
            .split('\0')
            .any(|record| record.split_whitespace().nth(2) == Some(stage));
        if !present {
            return self.remove_file(file);
        }
        let flag = match side {
            Side::Ours => "--ours",
            Side::Theirs => "--theirs",
        };
        self.run(
            &["checkout", flag, "--", &file.path],
            RunOptions::writing().literal(),
        )?;
        self.stage_resolved(&file.path)
    }

    pub(super) fn keep_file(&self, file: &ChangedFile) -> AppResult<()> {
        self.expect_conflicted(file)?;
        if !self.file_in_worktree(&file.path)?.exists() {
            return Err(AppError::invalid(
                "The file is not in the work tree; use Delete File.",
            ));
        }
        self.stage_resolved(&file.path)
    }

    pub(super) fn delete_file(&self, file: &ChangedFile) -> AppResult<()> {
        self.expect_conflicted(file)?;
        self.remove_file(file)
    }

    fn remove_file(&self, file: &ChangedFile) -> AppResult<()> {
        self.run(
            &["rm", "--quiet", "--force", "--", &file.path],
            RunOptions::writing().literal(),
        )?;
        Ok(())
    }

    /// Stages the work-tree file as it is. Conflict markers left in it need `force`.
    pub(super) fn mark_resolved(&self, file: &ChangedFile, force: bool) -> AppResult<()> {
        self.expect_conflicted(file)?;
        let path = self.file_in_worktree(&file.path)?;
        if !path.exists() {
            return self.remove_file(file);
        }
        let text = String::from_utf8_lossy(&read_file(&path)?).into_owned();
        if !force && markers::has_markers(&text) {
            return Err(AppError::new(
                ErrorKind::ConflictMarkers,
                format!(
                    "\u{201c}{}\u{201d} still contains conflict markers.",
                    file.path
                ),
            ));
        }
        self.stage_resolved(&file.path)
    }

    /// Writes the chosen chunks and stages the file, unless it changed since it was read.
    pub(super) fn save_resolution(
        &self,
        file: &ChangedFile,
        fingerprint: &str,
        choices: &[ChunkChoice],
    ) -> AppResult<()> {
        self.expect_conflicted(file)?;
        let path = self.file_in_worktree(&file.path)?;
        let bytes = read_file(&path)?;
        if markers::fingerprint(&bytes) != fingerprint {
            return Err(AppError::stale(
                "The file changed on disk since it was shown. Reload it and choose again.",
            ));
        }
        let text = String::from_utf8(bytes)
            .map_err(|_| AppError::invalid("The file is not UTF-8 text."))?;
        let segments = markers::parse(&text, self.base_markers()?).map_err(AppError::invalid)?;
        let resolved = markers::compose(&segments, choices).map_err(AppError::invalid)?;
        write_atomically(&path, resolved.as_bytes())?;
        self.stage_resolved(&file.path)
    }

    fn stage_resolved(&self, relative: &str) -> AppResult<()> {
        self.run(&["add", "--", relative], RunOptions::writing().literal())?;
        Ok(())
    }
}

/// File types that run something when opened, and are only shown in the file manager.
const RUNNABLE_EXTENSIONS: &[&str] = &[
    "app",
    "applescript",
    "bat",
    "cmd",
    "com",
    "command",
    "cpl",
    "desktop",
    "exe",
    "hta",
    "jar",
    "js",
    "jse",
    "lnk",
    "msc",
    "msi",
    "pif",
    "ps1",
    "py",
    "rb",
    "reg",
    "scpt",
    "scr",
    "sh",
    "terminal",
    "tool",
    "url",
    "vb",
    "vbe",
    "vbs",
    "webloc",
    "workflow",
    "ws",
    "wsf",
    "wsh",
];

fn runnable(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    if extension.is_some_and(|e| RUNNABLE_EXTENSIONS.contains(&e.as_str())) {
        return true;
    }
    executable_bit(path)
}

#[cfg(unix)]
fn executable_bit(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path).is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn executable_bit(_path: &Path) -> bool {
    false
}

/// Writes through a temporary file in the same folder, keeping the file's permissions, so
/// a crash or full disk never leaves a half-written file.
fn write_atomically(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let failed = |error: std::io::Error| {
        log::error!("writing {}: {error}", path.display());
        AppError::io("The resolved file could not be written.")
    };
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let temporary = path.with_file_name(format!(".{name}.ratelgit-save"));
    let permissions = fs::metadata(path).map_err(failed)?.permissions();
    let result = fs::write(&temporary, bytes)
        .and_then(|()| fs::set_permissions(&temporary, permissions))
        .and_then(|()| fs::rename(&temporary, path));
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(failed(error));
    }
    Ok(())
}

fn read_file(path: &Path) -> AppResult<Vec<u8>> {
    fs::read(path).map_err(|error| {
        log::error!("reading {}: {error}", path.display());
        AppError::io("The file could not be read.")
    })
}
