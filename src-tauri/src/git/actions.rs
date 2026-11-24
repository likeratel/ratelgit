//! Mutations the UI can ask for. Each checks its inputs against the repository's current
//! state before running, so an action built from an out-of-date screen is refused.

use std::collections::BTreeSet;

use serde::Deserialize;

use super::conflicts::Side;
use super::markers::ChunkChoice;
use super::models::{ChangeKind, ChangedFile};
use super::operation::Operation;
use super::patch::FilePatch;
use super::runner::{Git, RunOptions};
use super::validate;
use crate::error::{AppError, AppResult};

const MAX_SELECTED_LINES: usize = 1_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineOperation {
    Stage,
    Unstage,
    Discard,
}

/// One user action. `reference` is a full ref name such as `refs/heads/main`.
#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Action {
    Stage {
        file: ChangedFile,
    },
    Unstage {
        file: ChangedFile,
    },
    Discard {
        file: ChangedFile,
    },
    /// Applies the selected lines of `source`, the diff the user was looking at.
    ApplyLines {
        file: ChangedFile,
        source: String,
        lines: Vec<usize>,
        operation: LineOperation,
    },
    Commit {
        message: String,
    },
    CreateBranch {
        name: String,
    },
    SwitchBranch {
        reference: String,
    },
    CheckoutRemote {
        reference: String,
    },
    RenameBranch {
        reference: String,
        name: String,
    },
    DeleteBranch {
        reference: String,
        force: bool,
    },
    Merge {
        reference: String,
    },
    Rebase {
        reference: String,
    },
    Abort {
        operation: Operation,
    },
    /// `parent` is a folder token from `choose_worktree_parent`, or `None` for the folder that
    /// contains the project; `name` is the new folder's name.
    AddWorktree {
        reference: String,
        parent: Option<String>,
        name: String,
    },
    Stash {
        message: String,
    },
    ApplyStash {
        stash: String,
        revision: String,
    },
    DropStash {
        stash: String,
        revision: String,
    },
    Continue {
        operation: Operation,
        /// Merge commit message; `None` keeps Git's prepared message.
        message: Option<String>,
    },
    /// Takes the whole file from one side (stage 2 or 3), or deletes it if that side did.
    ResolveSide {
        file: ChangedFile,
        side: Side,
    },
    KeepFile {
        file: ChangedFile,
    },
    DeleteFile {
        file: ChangedFile,
    },
    /// Stages the work-tree file as it is; `force` accepts leftover conflict markers.
    MarkResolved {
        file: ChangedFile,
        force: bool,
    },
    /// Writes one choice per conflict chunk, if the file still has `fingerprint`, and stages it.
    SaveResolution {
        file: ChangedFile,
        fingerprint: String,
        choices: Vec<ChunkChoice>,
    },
    Fetch {},
    Pull {},
    Push {},
}

impl Git {
    pub fn execute(&self, action: &Action) -> AppResult<()> {
        match action {
            Action::Stage { file } => self.stage(file),
            Action::Unstage { file } => self.unstage(file),
            Action::Discard { file } => self.discard(file),
            Action::ApplyLines {
                file,
                source,
                lines,
                operation,
            } => self.apply_lines(file, source, lines, *operation),
            Action::Commit { message } => self.commit(message),
            Action::Stash { message } => self.stash(message),
            Action::Abort { operation } => self.abort(*operation),
            Action::Continue { operation, message } => {
                self.continue_operation(*operation, message.as_deref())
            }
            Action::ResolveSide { file, side } => self.resolve_side(file, *side),
            Action::KeepFile { file } => self.keep_file(file),
            Action::DeleteFile { file } => self.delete_file(file),
            Action::MarkResolved { file, force } => self.mark_resolved(file, *force),
            Action::SaveResolution {
                file,
                fingerprint,
                choices,
            } => {
                if choices.len() > MAX_SELECTED_LINES {
                    return Err(AppError::invalid("Too many choices."));
                }
                self.save_resolution(file, fingerprint, choices)
            }
            _ => self.execute_reference_action(action),
        }
    }

    /// Fails unless `file` is still listed with the same kind and status.
    fn expect_file(&self, file: &ChangedFile, kinds: &[ChangeKind]) -> AppResult<()> {
        validate::relative_path(&file.path)?;
        if !kinds.contains(&file.kind) || !self.working_files()?.contains(file) {
            return Err(AppError::stale(
                "The file status changed. Refresh and try again.",
            ));
        }
        Ok(())
    }

    fn stage(&self, file: &ChangedFile) -> AppResult<()> {
        self.expect_file(file, &[ChangeKind::Unstaged, ChangeKind::Untracked])?;
        if file.path.ends_with('/') {
            return Err(AppError::invalid(
                "Add this nested repository from a terminal.",
            ));
        }
        self.run(&["add", "--", &file.path], RunOptions::writing().literal())?;
        Ok(())
    }

    fn unstage(&self, file: &ChangedFile) -> AppResult<()> {
        self.expect_file(file, &[ChangeKind::Staged])?;
        let args: &[&str] = if self.resolve_commit("HEAD")?.is_none() {
            &["rm", "--cached", "--force", "--quiet", "--"]
        } else {
            &["restore", "--staged", "--"]
        };
        let args = [args, &[file.path.as_str()]].concat();
        self.run(&args, RunOptions::writing().literal())?;
        Ok(())
    }

    /// Restores a tracked file from the index, or deletes an untracked file. Cannot be undone.
    fn discard(&self, file: &ChangedFile) -> AppResult<()> {
        if file.is_conflicted() {
            return Err(AppError::invalid(
                "Resolve or abort the conflict instead of discarding.",
            ));
        }
        self.expect_file(file, &[ChangeKind::Unstaged, ChangeKind::Untracked])?;
        let args: Vec<&str> = match file.kind {
            ChangeKind::Untracked if file.path.ends_with('/') => {
                return Err(AppError::invalid(
                    "Remove this nested repository with your file manager.",
                ))
            }
            ChangeKind::Untracked => vec!["clean", "--force", "--quiet", "--", &file.path],
            _ => vec!["restore", "--worktree", "--", &file.path],
        };
        self.run(&args, RunOptions::writing().literal())?;
        Ok(())
    }

    fn apply_lines(
        &self,
        file: &ChangedFile,
        source: &str,
        lines: &[usize],
        operation: LineOperation,
    ) -> AppResult<()> {
        if file.is_conflicted() {
            return Err(AppError::invalid(
                "Stage a conflicted file as a whole after resolving it.",
            ));
        }
        if lines.len() > MAX_SELECTED_LINES {
            return Err(AppError::invalid("Too many lines selected."));
        }
        let kinds = match operation {
            LineOperation::Unstage => [ChangeKind::Staged],
            _ => [ChangeKind::Unstaged],
        };
        self.expect_file(file, &kinds)?;
        // The patch is built from what the user saw, so refuse if the file changed since then.
        let current = self.diff(file, None, false)?;
        if current.lossy || current.truncated {
            return Err(AppError::invalid(
                "Lines can only be staged in UTF-8 text diffs below the size limit. Stage the whole file instead.",
            ));
        }
        if current.text != source {
            return Err(AppError::stale(
                "The file changed since its diff was shown. Refresh and try again.",
            ));
        }
        let selection: BTreeSet<usize> = lines.iter().copied().collect();
        let patch = FilePatch::new(source).patch(&selection, operation != LineOperation::Stage)?;
        let target: &[&str] = match operation {
            LineOperation::Stage => &["--cached"],
            LineOperation::Unstage => &["--cached", "--reverse"],
            LineOperation::Discard => &["--reverse"],
        };
        let args = [
            &["apply"][..],
            target,
            &["--recount", "--whitespace=nowarn", "-"],
        ]
        .concat();
        let options = RunOptions {
            input: Some(patch.as_bytes()),
            ..RunOptions::writing()
        };
        self.run(&args, options)?;
        Ok(())
    }

    fn commit(&self, text: &str) -> AppResult<()> {
        validate::message(text)?;
        if text.trim().is_empty() {
            return Err(AppError::invalid("Enter a commit message."));
        }
        self.commit_message(text)
    }

    /// Commits with `text` as typed: only surrounding whitespace is tidied, so lines that
    /// start with `#` (such as `#123 fix login`) stay in the message.
    pub(super) fn commit_message(&self, text: &str) -> AppResult<()> {
        let options = RunOptions {
            input: Some(text.trim().as_bytes()),
            ..RunOptions::writing()
        };
        self.run(&["commit", "--cleanup=whitespace", "-F", "-"], options)?;
        Ok(())
    }

    fn stash(&self, text: &str) -> AppResult<()> {
        validate::message(text)?;
        let message = text.trim();
        let mut args = vec!["stash", "push", "--include-untracked"];
        if !message.is_empty() {
            args.extend(["-m", message]);
        }
        self.run(&args, RunOptions::writing())?;
        Ok(())
    }
}
