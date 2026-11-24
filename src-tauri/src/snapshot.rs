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
    /// The requested filter without refs that no longer exist.
    pub filter: Vec<String>,
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

pub fn load(git: &Git, filter: &[String]) -> AppResult<WorktreeSnapshot> {
    validate::filter_refs(filter)?;
    let references = git.references()?;
    let filter = prune_filter(filter, &references);
    let scope = Scope(filter.clone());
    let history = git.history(&scope, 0, HISTORY_PAGE_SIZE)?;
    Ok(WorktreeSnapshot {
        head_hidden: git.head_hidden(&scope)?,
        files: git.working_files()?,
        tracking: git.tracking()?,
        operation: git.operation_state()?,
        references,
        filter,
        history,
    })
}
