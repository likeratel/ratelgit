//! Merge, rebase, cherry-pick or revert that stopped in a worktree: what it is, how far it got,
//! and continuing or aborting it.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::runner::{Git, RunOptions};
use super::validate;
use crate::error::{AppError, AppResult};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Operation {
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

impl Operation {
    pub fn command(self) -> &'static str {
        match self {
            Operation::Merge => "merge",
            Operation::Rebase => "rebase",
            Operation::CherryPick => "cherry-pick",
            Operation::Revert => "revert",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationState {
    pub kind: Operation,
    /// The side written as "ours" (stage 2): the current branch in a merge, the commit being
    /// built on (`onto`) in a rebase.
    pub ours: Option<String>,
    /// The side written as "theirs" (stage 3): the merged branch, or the commit being replayed.
    pub theirs: Option<String>,
    /// Branch being rebased.
    pub branch: Option<String>,
    /// Rebase progress, 1-based.
    pub step: Option<u32>,
    pub total: Option<u32>,
    /// Paths still unmerged.
    pub conflicts: u32,
    /// Prepared commit message (`MERGE_MSG` without comment lines).
    pub message: Option<String>,
}

/// Paths of the state files, asked from Git so linked worktrees resolve correctly.
struct StateFiles {
    merge_head: PathBuf,
    rebase_merge: PathBuf,
    rebase_apply: PathBuf,
    cherry_pick_head: PathBuf,
    revert_head: PathBuf,
    merge_msg: PathBuf,
}

const STATE_FILES: [&str; 6] = [
    "MERGE_HEAD",
    "rebase-merge",
    "rebase-apply",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "MERGE_MSG",
];

/// Prepared messages and state files longer than this are cut.
const MESSAGE_LIMIT: u64 = 1024 * 1024;

/// Reads at most `limit` bytes of a text file.
fn read_limited(path: &std::path::Path, limit: u64) -> Option<String> {
    use std::io::Read;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(limit)
        .read_to_end(&mut bytes)
        .ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn read_trimmed(path: PathBuf) -> Option<String> {
    let text = read_limited(&path, MESSAGE_LIMIT)?;
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn read_number(path: PathBuf) -> Option<u32> {
    read_trimmed(path)?.parse().ok()
}

/// The prepared message without Git's comment lines (`# Conflicts:`, `#\tfile`, `#`).
/// Lines such as `#123 fix login` are message text and stay.
fn clean_message(text: &str) -> String {
    text.lines()
        .filter(|line| !is_comment(line))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

impl Git {
    fn state_files(&self) -> AppResult<StateFiles> {
        let mut args = vec!["rev-parse", "--path-format=absolute"];
        STATE_FILES
            .iter()
            .for_each(|name| args.extend(["--git-path", name]));
        let output = self.run(&args, RunOptions::default())?;
        let paths: Vec<PathBuf> = output
            .lines()
            .map(|line| PathBuf::from(line.trim_end_matches('\r')))
            .collect();
        let [merge_head, rebase_merge, rebase_apply, cherry_pick_head, revert_head, merge_msg] =
            <[PathBuf; 6]>::try_from(paths)
                .map_err(|_| AppError::git("Could not read the repository state."))?;
        Ok(StateFiles {
            merge_head,
            rebase_merge,
            rebase_apply,
            cherry_pick_head,
            revert_head,
            merge_msg,
        })
    }

    /// Kind of the stopped operation, if any.
    pub fn operation_in_progress(&self) -> AppResult<Option<Operation>> {
        let files = self.state_files()?;
        Ok(
            if files.rebase_merge.is_dir() || files.rebase_apply.is_dir() {
                Some(Operation::Rebase)
            } else if files.merge_head.is_file() {
                Some(Operation::Merge)
            } else if files.cherry_pick_head.is_file() {
                Some(Operation::CherryPick)
            } else if files.revert_head.is_file() {
                Some(Operation::Revert)
            } else {
                None
            },
        )
    }

    /// Details of the stopped operation for the banner.
    pub fn operation_state(&self) -> AppResult<Option<OperationState>> {
        let Some(kind) = self.operation_in_progress()? else {
            return Ok(None);
        };
        let files = self.state_files()?;
        let conflicts = self.unmerged_count()?;
        let message = || {
            read_limited(&files.merge_msg, MESSAGE_LIMIT)
                .map(|text| clean_message(&text))
                .filter(|text| !text.is_empty())
        };
        let state = OperationState {
            kind,
            ours: None,
            theirs: None,
            branch: None,
            step: None,
            total: None,
            conflicts,
            message: None,
        };
        Ok(Some(match kind {
            Operation::Rebase => self.rebase_state(state, &files),
            Operation::Merge => OperationState {
                ours: Some(self.current_branch_label()?),
                theirs: read_trimmed(files.merge_head.clone())
                    .and_then(|text| text.lines().next().map(|h| self.name_for(h))),
                message: message(),
                ..state
            },
            Operation::CherryPick | Operation::Revert => {
                let head = match kind {
                    Operation::CherryPick => files.cherry_pick_head.clone(),
                    _ => files.revert_head.clone(),
                };
                OperationState {
                    ours: Some(self.current_branch_label()?),
                    theirs: read_trimmed(head).map(|hash| self.commit_label(&hash)),
                    message: message(),
                    ..state
                }
            }
        }))
    }

    fn rebase_state(&self, state: OperationState, files: &StateFiles) -> OperationState {
        let (folder, step, total) = if files.rebase_merge.is_dir() {
            (&files.rebase_merge, "msgnum", "end")
        } else {
            (&files.rebase_apply, "next", "last")
        };
        let branch = read_trimmed(folder.join("head-name")).map(|name| {
            name.strip_prefix("refs/heads/")
                .map_or(name.clone(), str::to_string)
        });
        let replaying = read_trimmed(folder.join("stopped-sha"))
            .or_else(|| read_trimmed(folder.join("original-commit")));
        OperationState {
            ours: read_trimmed(folder.join("onto")).map(|hash| self.name_for(&hash)),
            theirs: replaying
                .map(|hash| self.commit_label(&hash))
                .or_else(|| branch.clone()),
            branch,
            step: read_number(folder.join(step)),
            total: read_number(folder.join(total)),
            ..state
        }
    }

    fn current_branch_label(&self) -> AppResult<String> {
        let output = self.run(
            &["symbolic-ref", "--quiet", "--short", "HEAD"],
            RunOptions::accepting(&[0, 1]),
        )?;
        let name = output.trim();
        Ok(if name.is_empty() {
            "HEAD".to_string()
        } else {
            name.to_string()
        })
    }

    /// A branch or tag that points at `hash`, or its short form.
    fn name_for(&self, hash: &str) -> String {
        let short: String = hash.chars().take(8).collect();
        if validate::hash(hash).is_err() {
            return short;
        }
        let points_at = format!("--points-at={hash}");
        self.run(
            &[
                "for-each-ref",
                &points_at,
                "--format=%(refname:short)",
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ],
            RunOptions::default(),
        )
        .ok()
        .and_then(|output| output.lines().next().map(str::to_string))
        .unwrap_or(short)
    }

    /// `abc1234 Subject` for a commit.
    fn commit_label(&self, hash: &str) -> String {
        let short: String = hash.chars().take(8).collect();
        if validate::hash(hash).is_err() {
            return short;
        }
        self.run(
            &["log", "-1", "--format=%h %s", hash, "--"],
            RunOptions::default(),
        )
        .map(|text| text.trim().to_string())
        .unwrap_or(short)
    }

    pub fn unmerged_count(&self) -> AppResult<u32> {
        let files = self.working_files()?;
        let count = files.iter().filter(|f| f.is_conflicted()).count();
        Ok(u32::try_from(count).unwrap_or(u32::MAX))
    }

    /// Checks that `operation` is the one stopped in this worktree, then aborts it.
    pub(super) fn abort(&self, operation: Operation) -> AppResult<()> {
        self.expect_operation(operation)?;
        self.run(&[operation.command(), "--abort"], RunOptions::writing())?;
        Ok(())
    }

    fn expect_operation(&self, operation: Operation) -> AppResult<()> {
        if self.operation_in_progress()? != Some(operation) {
            return Err(AppError::stale(format!(
                "No {} is in progress in this worktree.",
                operation.command()
            )));
        }
        Ok(())
    }

    /// Commits the resolved merge, or lets a rebase, cherry-pick or revert go on. A rebase that
    /// stops at the next conflict is not an error: the new state is shown instead.
    pub(super) fn continue_operation(
        &self,
        operation: Operation,
        message: Option<&str>,
    ) -> AppResult<()> {
        self.expect_operation(operation)?;
        if self.unmerged_count()? > 0 {
            return Err(AppError::invalid(
                "Resolve and stage every conflicted file before continuing.",
            ));
        }
        if operation == Operation::Merge {
            let prepared = self.operation_state()?.and_then(|state| state.message);
            return self.commit_merge(message.or(prepared.as_deref()));
        }
        let options = RunOptions {
            accept_editor: true,
            ..RunOptions::writing()
        };
        match self.run(&[operation.command(), "--continue"], options) {
            Ok(_) => Ok(()),
            Err(_) if self.stopped_again(operation)? => Ok(()),
            Err(error) => Err(error),
        }
    }

    fn stopped_again(&self, operation: Operation) -> AppResult<bool> {
        Ok(self.operation_in_progress()? == Some(operation) && self.unmerged_count()? > 0)
    }

    /// Commits with the given (or prepared) message. Git's comment lines were already taken
    /// out of the prepared message; anything the user typed, `#` lines included, is kept.
    fn commit_merge(&self, message: Option<&str>) -> AppResult<()> {
        let text = message.map(str::trim).unwrap_or_default();
        if text.is_empty() {
            return Err(AppError::invalid("Enter a merge commit message."));
        }
        validate::message(text)?;
        self.commit_message(text)
    }
}

fn is_comment(line: &str) -> bool {
    line == "#" || line.starts_with("# ") || line.starts_with("#\t")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_lose_comment_lines() {
        let text = "Merge branch 'x'\n\n# Conflicts:\n#\tREADME.md\n#\n";
        assert_eq!(clean_message(text), "Merge branch 'x'");
        assert_eq!(clean_message("#123 fix\n# Conflicts:\n"), "#123 fix");
    }
}
