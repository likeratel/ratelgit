//! Everything the workspace shows for one worktree, read in one background pass.

use serde::Serialize;

use crate::error::AppResult;
use crate::git::{
    validate, ChangedFile, Git, HistoryPage, OperationState, Reference, Scope, Tracking,
    HISTORY_PAGE_SIZE,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSnapshot {
    pub references: Vec<Reference>,
    /// The filter used: the requested one without refs that no longer exist, or the default
    /// filter when none was requested.
    pub filter: Vec<String>,
    /// What the default filter is for this worktree right now.
    pub default_filter: Vec<String>,
    pub history: HistoryPage,
    /// The filter hides the commit this worktree has checked out.
    pub head_hidden: bool,
    pub files: Vec<ChangedFile>,
    pub tracking: Option<Tracking>,
    pub operation: Option<OperationState>,
}

/// Drops refs that no longer exist, for example after a branch was deleted.
pub fn prune_filter(filter: &[String], references: &[Reference]) -> Vec<String> {
    filter
        .iter()
        .filter(|id| *id == "HEAD" || references.iter().any(|r| &r.id == *id))
        .cloned()
        .collect()
}

/// Remote mainlines added to the default filter when they exist.
const MAINLINES: &[&str] = &["refs/remotes/origin/main", "refs/remotes/origin/master"];

/// The default History filter: the checked-out commit (`HEAD`, which follows checkouts and
/// detached heads) plus `origin/main` and `origin/master` when they exist.
pub fn default_filter(git: &Git) -> AppResult<Vec<String>> {
    let references = git.references()?;
    Ok(default_from(&references))
}

fn default_from(references: &[Reference]) -> Vec<String> {
    std::iter::once("HEAD")
        .chain(
            MAINLINES
                .iter()
                .copied()
                .filter(|id| references.iter().any(|r| r.id == *id)),
        )
        .map(str::to_string)
        .collect()
}

/// The filter to use: `None` asks for the default filter.
pub fn effective_filter(git: &Git, filter: Option<&[String]>) -> AppResult<Vec<String>> {
    match filter {
        Some(refs) => Ok(refs.to_vec()),
        None => default_filter(git),
    }
}

/// Reads a worktree. `filter` is `None` for the default filter, `Some(&[])` for every branch.
pub fn load(git: &Git, filter: Option<&[String]>) -> AppResult<WorktreeSnapshot> {
    if let Some(refs) = filter {
        validate::filter_refs(refs)?;
    }
    let references = git.references()?;
    let default_filter = default_from(&references);
    let requested = filter.map_or_else(|| default_filter.clone(), <[String]>::to_vec);
    let filter = prune_filter(&requested, &references);
    let scope = Scope(filter.clone());
    let history = git.history(&scope, 0, HISTORY_PAGE_SIZE)?;
    Ok(WorktreeSnapshot {
        head_hidden: git.head_hidden(&scope)?,
        files: git.working_files()?,
        tracking: git.tracking()?,
        operation: git.operation_state()?,
        references,
        filter,
        default_filter,
        history,
    })
}
