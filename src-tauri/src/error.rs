use serde::Serialize;

/// Rejected value of every command: `{ kind, message }`, as described in `CONTRACT.md`.
///
/// `message` is shown to the user. Git's own error text is included because it is what the
/// user needs to act on (a conflict, a rejected push), but internal detail such as OS error
/// codes goes to the log at the failure site.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// An argument failed validation in the core.
    InvalidInput,
    /// No usable Git executable was found.
    GitMissing,
    /// Git is older than the version ratelgit needs.
    GitTooOld,
    /// The folder or worktree is missing or not part of a registered project.
    NotFound,
    /// Git ran and reported a failure; the message carries Git's text.
    GitFailed,
    /// What the user saw is out of date (the file or stash list changed). Refresh and retry.
    Stale,
    /// `git branch -d` refused because the branch is not merged; the UI may offer a force delete.
    NotFullyMerged,
    /// Marking a file resolved was refused because conflict markers remain; the UI may confirm.
    ConflictMarkers,
    /// Reading or writing the app's own files failed.
    Io,
    /// File content is not in this partial clone and reading never fetches it.
    MissingObjects,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::InvalidInput, message)
    }

    pub fn git(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::GitFailed, message)
    }

    pub fn stale(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Stale, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::NotFound, message)
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Io, message)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_kind_and_message() {
        let error = AppError::new(ErrorKind::NotFullyMerged, "Not merged.");
        let json = serde_json::to_value(&error).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "not_fully_merged", "message": "Not merged." })
        );
    }
}
