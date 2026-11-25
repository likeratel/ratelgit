//! Creating worktrees, and removing them together with their branch.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::branches::is_unc;
use super::operation::Operation;
use super::runner::{Git, RunOptions, NETWORK_TIMEOUT};
use super::validate;
use crate::error::{AppError, AppResult, ErrorKind};

/// The branch a new worktree checks out.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum WorktreeBranch {
    /// A new branch `name` starting at `start_point` (a full ref name or `HEAD`). It does not
    /// track its start point, so a push never goes to the start point's branch by accident.
    New { name: String, start_point: String },
    /// A local branch that no worktree has checked out.
    Existing { reference: String },
    /// A remote branch, checked out as a new local branch that tracks it.
    Remote { reference: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBranch {
    pub remote: String,
    /// Branch name on the remote.
    pub name: String,
}

/// What removing a worktree would delete, for the confirmation dialog.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovalPreview {
    pub path: String,
    /// Checked-out branch; `None` for a detached HEAD.
    pub branch: Option<String>,
    pub is_main: bool,
    /// The folder is gone; removing only cleans up Git's record of it.
    pub prunable: bool,
    /// Lock reason (empty when locked without one).
    pub locked: Option<String>,
    pub operation: Option<Operation>,
    /// Changed tracked files that would be lost.
    pub changes: u32,
    /// Untracked files that would be lost.
    pub untracked: u32,
    /// Commits of the branch (or detached HEAD) on no other branch, remote branch or tag.
    pub unmerged_commits: u32,
    /// Commits lost when the remote branch (the upstream) is deleted too.
    pub unmerged_with_remote: u32,
    /// Ignored files and folders (a folder counts once) that would be deleted.
    pub ignored: u32,
    /// A few of the ignored names, to show in the warning.
    pub ignored_examples: Vec<String>,
    /// The worktree contains submodules; Git removes it only with force.
    pub submodules: bool,
    pub upstream: Option<RemoteBranch>,
    /// Why the remote branch must not be deleted, if it must not.
    pub remote_block: Option<String>,
    /// Why the local branch must not be deleted, if it must not.
    pub branch_block: Option<String>,
    /// Commit of the branch, or the detached HEAD, when the preview was made.
    pub tip: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoveOptions {
    /// Remove even with changes, a stopped merge or rebase, or a lock.
    pub force: bool,
    pub delete_branch: bool,
    /// Delete the branch although its commits are on no other ref.
    pub allow_unmerged: bool,
    pub delete_remote: bool,
    /// What the user saw and agreed to lose. The removal is refused if more would be lost now.
    pub seen: Seen,
}

/// The losses a removal preview showed, sent back with the request.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Seen {
    pub changes: u32,
    pub untracked: u32,
    pub ignored: u32,
    /// Commits lost with the chosen branch deletions (`commits_lost`).
    pub lost_commits: u32,
    pub locked: bool,
    pub operation: bool,
    pub submodules: bool,
    /// Branch tip (or detached HEAD) the preview was made at.
    pub tip: Option<String>,
}

impl Seen {
    /// What `preview` shows for the deletions chosen in `options`.
    pub fn of(preview: &RemovalPreview, options: &RemoveOptions) -> Self {
        Self {
            changes: preview.changes,
            untracked: preview.untracked,
            ignored: preview.ignored,
            lost_commits: commits_lost(preview, options),
            locked: preview.locked.is_some(),
            operation: preview.operation.is_some(),
            submodules: preview.submodules,
            tip: preview.tip.clone(),
        }
    }
}

/// What a removal did. Later steps run only after earlier ones succeed; `problem` says what
/// did not happen.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovalResult {
    pub branch_deleted: Option<bool>,
    pub remote_deleted: Option<bool>,
    pub problem: Option<String>,
}

/// Ignored names shown in the warning.
const IGNORED_EXAMPLES: usize = 3;

/// One entry of `git worktree list --porcelain`.
struct Record {
    path: String,
    head: Option<String>,
    branch: Option<String>,
    locked: Option<String>,
    prunable: bool,
}

fn parse_records(output: &str) -> Vec<Record> {
    output
        .split("\0\0")
        .filter_map(|record| {
            let fields: Vec<&str> = record.split('\0').filter(|f| !f.is_empty()).collect();
            let path = fields.first()?.strip_prefix("worktree ")?.to_string();
            let value = |prefix: &str| fields.iter().find_map(|f| f.strip_prefix(prefix));
            let locked = fields
                .iter()
                .find(|f| **f == "locked" || f.starts_with("locked "))
                .map(|f| f.strip_prefix("locked").unwrap_or("").trim().to_string());
            Some(Record {
                head: value("HEAD ").map(str::to_string),
                branch: value("branch refs/heads/").map(str::to_string),
                prunable: fields.iter().any(|f| f.starts_with("prunable"))
                    || !Path::new(&path).is_dir(),
                locked,
                path,
            })
        })
        .collect()
}

fn same_place(a: &str, b: &str) -> bool {
    a == b || matches!((dunce::canonicalize(a), dunce::canonicalize(b)), (Ok(x), Ok(y)) if x == y)
}

fn count(text: &str) -> u32 {
    text.trim().parse().unwrap_or(0)
}

impl Git {
    /// Fails unless `name` is a valid branch name that does not exist yet.
    pub fn check_new_branch(&self, name: &str) -> AppResult<()> {
        self.validate_branch_name(name)?;
        let full = format!("refs/heads/{name}");
        if self.resolve_commit(&full)?.is_some() {
            return Err(AppError::invalid(format!(
                "A branch named \u{201c}{name}\u{201d} already exists."
            )));
        }
        Ok(())
    }

    /// Adds a worktree at `location` (absolute; missing or an empty folder).
    pub fn create_worktree(&self, branch: &WorktreeBranch, location: &Path) -> AppResult<()> {
        if !location.is_absolute() || is_unc(location) {
            return Err(AppError::invalid(
                "Choose a folder on a local drive for the new worktree.",
            ));
        }
        let place = location.to_string_lossy();
        let writing = RunOptions::writing();
        match branch {
            WorktreeBranch::Existing { reference } => self.add_worktree(reference, location),
            WorktreeBranch::New { name, start_point } => {
                self.check_new_branch(name)?;
                validate::filter_ref(start_point)?;
                if self.resolve_commit(start_point)?.is_none() {
                    return Err(AppError::invalid("The start point does not exist."));
                }
                let args = [
                    "worktree",
                    "add",
                    "--no-track",
                    "-b",
                    name,
                    "--",
                    &place,
                    start_point,
                ];
                self.run(&args, writing).map(|_| ())
            }
            WorktreeBranch::Remote { reference } => {
                let local = self.tracking_name(reference)?;
                self.check_new_branch(&local)?;
                let args = [
                    "worktree", "add", "--track", "-b", &local, "--", &place, reference,
                ];
                self.run(&args, writing).map(|_| ())
            }
        }
    }

    fn records(&self) -> AppResult<Vec<Record>> {
        let output = self.run(
            &["worktree", "list", "--porcelain", "-z"],
            RunOptions::default(),
        )?;
        Ok(parse_records(&output))
    }

    /// The project's default branch: what `origin/HEAD` points at, else `main` or `master`.
    pub fn default_branch(&self) -> AppResult<Option<String>> {
        if let Some(name) = self.remote_head("origin")? {
            return Ok(Some(name));
        }
        for name in ["main", "master"] {
            if self
                .resolve_commit(&format!("refs/heads/{name}"))?
                .is_some()
            {
                return Ok(Some(name.to_string()));
            }
        }
        Ok(None)
    }

    /// Branch the remote's `HEAD` points at, if the remote has one recorded.
    fn remote_head(&self, remote: &str) -> AppResult<Option<String>> {
        let head = format!("refs/remotes/{remote}/HEAD");
        let output = self.run(
            &["symbolic-ref", "--quiet", &head],
            RunOptions::accepting(&[0, 1, 128]),
        )?;
        let prefix = format!("refs/remotes/{remote}/");
        Ok(output.trim().strip_prefix(&prefix).map(str::to_string))
    }

    /// Branches never deleted with a worktree: `origin/HEAD`'s branch, or without it
    /// `init.defaultBranch`, `main` and `master`.
    fn protected_branches(&self) -> AppResult<Vec<String>> {
        if let Some(name) = self.remote_head("origin")? {
            return Ok(vec![name]);
        }
        let configured = self.run(
            &["config", "--get", "init.defaultBranch"],
            RunOptions::accepting(&[0, 1]),
        )?;
        let configured = configured.trim();
        Ok(["main", "master", configured]
            .into_iter()
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .collect())
    }

    /// Why deleting the upstream of `branch` is not allowed, if it is not: it has another
    /// name (a branch made from `origin/develop` must not delete `develop`), or it is the
    /// remote's default branch.
    fn remote_block(&self, branch: &str, upstream: &RemoteBranch) -> AppResult<Option<String>> {
        let full = format!("{}/{}", upstream.remote, upstream.name);
        if upstream.name != branch {
            return Ok(Some(format!(
                "Its upstream is {full}, a branch with another name, so it is kept."
            )));
        }
        let default = self.remote_head(&upstream.remote)?;
        let is_default = default.as_deref() == Some(upstream.name.as_str())
            || matches!(upstream.name.as_str(), "main" | "master");
        Ok(is_default.then(|| format!("{full} is the remote's default branch, so it is kept.")))
    }

    fn upstream_of(&self, branch: &str) -> AppResult<Option<RemoteBranch>> {
        let full = format!("refs/heads/{branch}");
        let output = self.run(
            &[
                "for-each-ref",
                "--format=%(upstream:remotename)%00%(upstream:remoteref)",
                &full,
            ],
            RunOptions::default(),
        )?;
        let fields: Vec<&str> = output.trim_end().split('\0').collect();
        Ok(match fields[..] {
            [remote, target] if !remote.is_empty() && remote != "." => {
                target.strip_prefix("refs/heads/").map(|name| RemoteBranch {
                    remote: remote.to_string(),
                    name: name.to_string(),
                })
            }
            _ => None,
        })
    }

    /// Commits of `tip` that no other branch, remote branch or tag contains. `own` is left out
    /// of the branches and `remote` (`origin/topic`) of the remote branches.
    fn unmerged(&self, tip: &str, own: Option<&str>, remote: Option<&str>) -> AppResult<u32> {
        // Before `--branches` the pattern is the short name. Branch names never contain glob
        // characters (`check-ref-format` refuses `*`, `?` and `[`).
        let exclude = own.map(|b| format!("--exclude={b}"));
        let remote_exclude = remote.map(|r| format!("--exclude={r}"));
        let mut args = vec!["rev-list", "--count", tip, "--not"];
        args.extend(exclude.as_deref());
        args.push("--branches");
        args.extend(remote_exclude.as_deref());
        args.extend(["--remotes", "--tags", "--"]);
        Ok(count(&self.run(&args, RunOptions::default())?))
    }

    /// What removing the worktree at `target` would delete. `self` is any worktree of the
    /// project; `target` must be one of its worktrees.
    pub fn removal_preview(&self, target: &str) -> AppResult<RemovalPreview> {
        let records = self.records()?;
        let position = records
            .iter()
            .position(|r| same_place(&r.path, target))
            .ok_or_else(|| AppError::not_found("This folder is not a worktree of the project."))?;
        let record = &records[position];
        let mut preview = RemovalPreview {
            path: record.path.clone(),
            branch: record.branch.clone(),
            is_main: position == 0,
            prunable: record.prunable,
            locked: record.locked.clone(),
            operation: None,
            changes: 0,
            untracked: 0,
            unmerged_commits: 0,
            unmerged_with_remote: 0,
            ignored: 0,
            ignored_examples: Vec::new(),
            submodules: false,
            upstream: None,
            remote_block: None,
            branch_block: None,
            tip: None,
        };
        if !record.prunable {
            let tree = Git::new(&record.path);
            let files = tree.working_files()?;
            let untracked = files
                .iter()
                .filter(|f| f.kind == super::ChangeKind::Untracked)
                .count();
            let mut changed: Vec<&str> = files
                .iter()
                .filter(|f| f.kind != super::ChangeKind::Untracked)
                .map(|f| f.path.as_str())
                .collect();
            changed.dedup();
            preview.changes = u32::try_from(changed.len()).unwrap_or(u32::MAX);
            preview.untracked = u32::try_from(untracked).unwrap_or(u32::MAX);
            preview.operation = tree.operation_in_progress()?;
            let ignored = tree.ignored_entries()?;
            preview.ignored = u32::try_from(ignored.len()).unwrap_or(u32::MAX);
            preview.ignored_examples = ignored.into_iter().take(IGNORED_EXAMPLES).collect();
            preview.submodules = tree.has_submodules()?;
        }
        if let Some(branch) = &record.branch {
            let tip = format!("refs/heads/{branch}");
            preview.tip = self.resolve_commit(&tip)?;
            preview.upstream = self.upstream_of(branch)?;
            preview.unmerged_commits = self.unmerged(&tip, Some(branch), None)?;
            preview.unmerged_with_remote = match &preview.upstream {
                Some(up) => {
                    let remote = format!("{}/{}", up.remote, up.name);
                    self.unmerged(&tip, Some(branch), Some(&remote))?
                }
                None => preview.unmerged_commits,
            };
            preview.branch_block = self.branch_block(branch, &records, position)?;
            preview.remote_block = match &preview.upstream {
                Some(up) => self.remote_block(branch, up)?,
                None => None,
            };
        } else if let Some(head) = &record.head {
            preview.tip = Some(head.clone());
            preview.unmerged_commits = self.unmerged(head, None, None)?;
            preview.unmerged_with_remote = preview.unmerged_commits;
        }
        Ok(preview)
    }

    /// Ignored files and folders in this worktree, a fully ignored folder as one entry.
    fn ignored_entries(&self) -> AppResult<Vec<String>> {
        let output = self.run(
            &[
                "ls-files",
                "-z",
                "--others",
                "--ignored",
                "--exclude-standard",
                "--directory",
            ],
            RunOptions::default(),
        )?;
        let entries: Vec<&str> = output.split('\0').filter(|e| !e.is_empty()).collect();
        // Git can list a folder of ignored files and the files in it; count the folder once.
        let folders: Vec<&str> = entries
            .iter()
            .copied()
            .filter(|e| e.ends_with('/'))
            .collect();
        Ok(entries
            .iter()
            .copied()
            .filter(|e| !folders.iter().any(|f| *f != *e && e.starts_with(f)))
            .map(str::to_string)
            .collect())
    }

    /// Whether the index has submodules (gitlinks).
    fn has_submodules(&self) -> AppResult<bool> {
        let output = self.run(&["ls-files", "-z", "--stage"], RunOptions::default())?;
        Ok(output.split('\0').any(|entry| entry.starts_with("160000 ")))
    }

    fn branch_block(
        &self,
        branch: &str,
        records: &[Record],
        position: usize,
    ) -> AppResult<Option<String>> {
        if self.protected_branches()?.iter().any(|name| name == branch) {
            return Ok(Some(format!(
                "\u{201c}{branch}\u{201d} is the project's default branch."
            )));
        }
        let elsewhere = records
            .iter()
            .enumerate()
            .find(|(i, r)| *i != position && r.branch.as_deref() == Some(branch));
        Ok(elsewhere.map(|(_, r)| {
            format!(
                "\u{201c}{branch}\u{201d} is also checked out in {}.",
                r.path
            )
        }))
    }

    /// Removes a linked worktree, then (if asked) its local branch, then its remote branch.
    /// Everything is checked first; a later step runs only if the earlier one worked, and the
    /// result says exactly which steps did not happen.
    pub fn remove_worktree(
        &self,
        target: &str,
        options: &RemoveOptions,
    ) -> AppResult<RemovalResult> {
        let preview = self.removal_preview(target)?;
        if preview.is_main {
            return Err(AppError::invalid(
                "The main worktree of a project cannot be removed.",
            ));
        }
        if preview.prunable {
            // Only this record: other worktrees may be on a drive that is just unplugged.
            self.run(
                &["worktree", "remove", "--", &preview.path],
                RunOptions::writing(),
            )?;
            return Ok(RemovalResult {
                branch_deleted: None,
                remote_deleted: None,
                problem: None,
            });
        }
        check_consent(&preview, options)?;
        check_unchanged(&preview, options)?;
        // From here to `worktree remove` there is a short window in which the folder could
        // still change; with `--force` Git does not check again. The preview above is read
        // right before this call to keep that window as small as possible.
        let mut args = vec!["worktree", "remove"];
        if options.force {
            args.push("--force");
            if preview.locked.is_some() {
                args.push("--force");
            }
        }
        args.extend(["--", preview.path.as_str()]);
        self.run(&args, RunOptions::writing())?;
        self.delete_branches(&preview, options)
    }

    /// Deletes the remote branch only if it is still where this clone last saw it
    /// (`--force-with-lease`), so commits someone pushed since the last fetch are never lost.
    fn delete_remote_branch(&self, remote: &str, refspec: &str, full: &str) -> AppResult<()> {
        let seen = self
            .resolve_commit(&format!("refs/remotes/{full}"))?
            .ok_or_else(|| AppError::git("stale info: the remote branch was never fetched"))?;
        let lease = format!("--force-with-lease={refspec}:{seen}");
        let options = RunOptions {
            timeout: NETWORK_TIMEOUT,
            ..RunOptions::writing()
        };
        self.run(
            &[
                "push",
                "--delete",
                &lease,
                "--no-recurse-submodules",
                "--",
                remote,
                refspec,
            ],
            options,
        )
        .map(|_| ())
    }

    fn delete_branches(
        &self,
        preview: &RemovalPreview,
        options: &RemoveOptions,
    ) -> AppResult<RemovalResult> {
        let mut result = RemovalResult {
            branch_deleted: None,
            remote_deleted: None,
            problem: None,
        };
        let Some(branch) = preview.branch.as_deref().filter(|_| options.delete_branch) else {
            return Ok(result);
        };
        // Safe to force: commits are on another ref, or the user agreed to lose them.
        if let Err(error) = self.run(&["branch", "-D", "--", branch], RunOptions::writing()) {
            result.branch_deleted = Some(false);
            result.problem = Some(format!(
                "The worktree was removed, but deleting the local branch \u{201c}{branch}\u{201d} failed{}: {}",
                if options.delete_remote { ", so the remote branch was kept" } else { "" },
                error.message
            ));
            return Ok(result);
        }
        result.branch_deleted = Some(true);
        let Some(upstream) = preview.upstream.as_ref().filter(|_| options.delete_remote) else {
            return Ok(result);
        };
        let refspec = format!("refs/heads/{}", upstream.name);
        let full = format!("{}/{}", upstream.remote, upstream.name);
        let pushed = self.delete_remote_branch(&upstream.remote, &refspec, &full);
        result.remote_deleted = Some(pushed.is_ok());
        if let Err(error) = pushed {
            result.problem = Some(if error.message.contains("stale info") {
                format!("The worktree and the local branch were removed, but the remote branch {full} changed since the last fetch, so it was not deleted. Fetch and check it again.")
            } else {
                format!("The worktree and the local branch were removed, but deleting the remote branch {full} failed: {}", error.message)
            });
        }
        Ok(result)
    }
}

/// Commits that the chosen deletions would leave on no ref at all.
pub fn commits_lost(preview: &RemovalPreview, options: &RemoveOptions) -> u32 {
    match (
        &preview.branch,
        options.delete_branch,
        options.delete_remote,
    ) {
        // A detached HEAD's own commits go with the worktree.
        (None, _, _) => preview.unmerged_commits,
        (Some(_), false, _) => 0,
        (Some(_), true, false) => preview.unmerged_commits,
        (Some(_), true, true) => preview.unmerged_with_remote,
    }
}

/// Refuses with `stale` when more would be lost now than the preview the user agreed to
/// showed: more files or commits, a new kind of loss, or a branch that moved. Less is fine.
fn check_unchanged(now: &RemovalPreview, options: &RemoveOptions) -> AppResult<()> {
    let current = Seen::of(now, options);
    let seen = &options.seen;
    let grew = current.changes > seen.changes
        || current.untracked > seen.untracked
        || current.ignored > seen.ignored
        || current.lost_commits > seen.lost_commits
        || (current.locked && !seen.locked)
        || (current.operation && !seen.operation)
        || (current.submodules && !seen.submodules)
        || current.tip != seen.tip;
    if grew {
        return Err(AppError::stale(
            "The worktree changed since it was checked. Review what would be lost again.",
        ));
    }
    Ok(())
}

/// Refuses before anything is touched unless the user agreed to every loss.
fn check_consent(preview: &RemovalPreview, options: &RemoveOptions) -> AppResult<()> {
    let refuse = |message: String| Err(AppError::new(ErrorKind::InvalidInput, message));
    let needs_force = preview.locked.is_some()
        || preview.operation.is_some()
        || preview.changes + preview.untracked + preview.ignored > 0
        || preview.submodules;
    if needs_force && !options.force {
        return refuse(
            "Removing this worktree deletes files or overrides a lock, a stopped merge or rebase, or submodules. Confirm to remove it anyway."
                .into(),
        );
    }
    if options.delete_branch {
        let Some(branch) = &preview.branch else {
            return refuse("The worktree has no branch checked out.".into());
        };
        if let Some(reason) = &preview.branch_block {
            return refuse(format!("{reason} The branch is kept."));
        }
        let _ = branch;
    }
    if options.delete_remote {
        if !options.delete_branch || preview.upstream.is_none() {
            return refuse("The remote branch can only be deleted together with a local branch that has an upstream.".into());
        }
        if let Some(reason) = &preview.remote_block {
            return refuse(reason.clone());
        }
    }
    if commits_lost(preview, options) > 0 && !options.allow_unmerged {
        return refuse("Some commits would be on no branch, remote branch or tag afterwards. Confirm to lose them.".into());
    }
    Ok(())
}
