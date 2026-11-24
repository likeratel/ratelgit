//! Payloads that cross the IPC boundary. Field names are camelCase in JSON; see `CONTRACT.md`.

use serde::{Deserialize, Serialize};

use super::conflicts::ConflictKind;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    /// Absolute path as Git reports it (forward slashes on Windows too).
    pub path: String,
    pub name: String,
    /// Checked-out branch; `None` for a detached HEAD.
    pub branch: Option<String>,
    /// The first worktree Git lists; it identifies the repository.
    pub is_main: bool,
    /// The folder is missing, prunable or bare.
    pub unavailable: bool,
    /// Changed paths (staged, unstaged and untracked counted once); `None` if unreadable.
    pub changes: Option<u32>,
    /// Commits ahead of and behind the upstream; `None` without a usable upstream.
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RefKind {
    Local,
    Remote,
    Tag,
    Stash,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    /// Full ref name such as `refs/heads/main`, or `stash@{n}` for a stash.
    pub id: String,
    /// Short name: `main`, `origin/main`, `v1.0`, `stash@{0}`.
    pub name: String,
    pub kind: RefKind,
    /// Commit the ref points at, peeled for annotated tags.
    pub target: Option<String>,
    /// Checked out in the worktree the refs were read from.
    pub is_head: bool,
    /// Worktree that has this branch checked out, if any.
    pub worktree_path: Option<String>,
    /// Stash message such as `On main: draft`; `None` for other refs.
    pub subject: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitLine {
    /// Position in the whole listing, stable across pages.
    pub index: usize,
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    /// Author date as `YYYY-MM-DD`.
    pub date: String,
    /// Author date as seconds since the Unix epoch.
    pub timestamp: i64,
    /// Decorations from `%D`, e.g. `HEAD -> main`, `origin/main`, `tag: v1.0`.
    pub refs: Vec<String>,
    pub parents: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub lines: Vec<CommitLine>,
    /// No more commits after this page.
    pub complete: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    /// Strict ISO 8601 author date.
    pub date: String,
    pub message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Staged,
    Unstaged,
    Untracked,
    Committed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangedFile {
    /// Repository-relative path with `/` separators.
    pub path: String,
    pub kind: ChangeKind,
    /// One letter: `M`, `A`, `D`, `T`, `?` (untracked) or `U` (conflicted).
    pub status: String,
    /// What each side did, for conflicted files.
    #[serde(default)]
    pub conflict: Option<ConflictKind>,
}

impl ChangedFile {
    pub fn is_conflicted(&self) -> bool {
        self.status == "U"
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tracking {
    pub branch: String,
    pub remote: String,
    /// Upstream branch on the remote, e.g. `refs/heads/main`.
    pub target: String,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub text: String,
    /// Git's output was not valid UTF-8 and was decoded with replacements. Line staging is off.
    pub lossy: bool,
    /// The diff was cut at the size limit. Line staging is off.
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub detail: CommitDetail,
    pub files: Vec<ChangedFile>,
}
