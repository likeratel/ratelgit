//! Finds the Git executable once. Apps launched from Finder or the Start menu get a short
//! `PATH`, so well-known install locations are tried after `PATH`.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::error::{AppError, AppResult, ErrorKind};

static GIT: OnceLock<PathBuf> = OnceLock::new();

#[cfg(windows)]
const EXECUTABLE: &str = "git.exe";
#[cfg(not(windows))]
const EXECUTABLE: &str = "git";

#[cfg(target_os = "macos")]
const FALLBACKS: &[&str] = &[
    "/opt/homebrew/bin/git",
    "/usr/local/bin/git",
    "/usr/bin/git",
];
#[cfg(windows)]
const FALLBACKS: &[&str] = &[
    r"C:\Program Files\Git\cmd\git.exe",
    r"C:\Program Files (x86)\Git\cmd\git.exe",
];
#[cfg(not(any(target_os = "macos", windows)))]
const FALLBACKS: &[&str] = &["/usr/bin/git", "/usr/local/bin/git"];

pub const MISSING_MESSAGE: &str =
    "Git was not found. Install Git (https://git-scm.com) and restart ratelgit.";

/// Oldest Git with every option ratelgit passes (`worktree list -z` arrived in 2.36).
pub const MINIMUM_VERSION: (u32, u32) = (2, 36);

/// Path of the Git executable. Only a successful lookup is cached, so installing or updating
/// Git and trying again works without a restart.
pub fn git_executable() -> AppResult<&'static Path> {
    if let Some(found) = GIT.get() {
        return Ok(found.as_path());
    }
    let found = candidates()
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| AppError::new(ErrorKind::GitMissing, MISSING_MESSAGE))?;
    check_version(&found)?;
    Ok(GIT.get_or_init(|| found).as_path())
}

/// `PATH` entries first, then the usual install folders. Relative entries are skipped, so a
/// `git` in whatever folder the app was started from is never picked up.
fn candidates() -> Vec<PathBuf> {
    let from_path = std::env::var_os("PATH")
        .map(|value| {
            std::env::split_paths(&value)
                .filter(|directory| directory.is_absolute())
                .map(|directory| directory.join(EXECUTABLE))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    from_path
        .into_iter()
        .chain(FALLBACKS.iter().map(PathBuf::from))
        .filter(|candidate| candidate.is_absolute())
        .collect()
}

fn check_version(git: &Path) -> AppResult<()> {
    let mut command = std::process::Command::new(git);
    command
        .arg("--version")
        .env("LC_ALL", "C")
        .stdin(std::process::Stdio::null());
    hide_console(&mut command);
    let output = command.output().map_err(|error| {
        log::error!("running git --version failed: {error}");
        AppError::new(ErrorKind::GitMissing, MISSING_MESSAGE)
    })?;
    let text = String::from_utf8_lossy(&output.stdout);
    match parse_version(&text) {
        Some(version) if version >= MINIMUM_VERSION => Ok(()),
        Some((major, minor)) => Err(AppError::new(
            ErrorKind::GitTooOld,
            format!(
                "ratelgit needs Git {}.{} or later; this computer has Git {major}.{minor}. Update Git and try again.",
                MINIMUM_VERSION.0, MINIMUM_VERSION.1
            ),
        )),
        None => Err(AppError::new(ErrorKind::GitMissing, MISSING_MESSAGE)),
    }
}

#[cfg(windows)]
fn hide_console(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut std::process::Command) {}

/// `git version 2.39.3 (Apple Git-146)` or `git version 2.45.1.windows.1` to `(2, 39)`.
pub fn parse_version(text: &str) -> Option<(u32, u32)> {
    let number = text
        .trim()
        .strip_prefix("git version ")?
        .split_whitespace()
        .next()?;
    let mut parts = number.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    Some((major, minor))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_parse_and_compare() {
        assert_eq!(
            parse_version("git version 2.39.3 (Apple Git-146)\n"),
            Some((2, 39))
        );
        assert_eq!(parse_version("git version 2.45.1.windows.1"), Some((2, 45)));
        assert_eq!(parse_version("git version 3.0.0"), Some((3, 0)));
        assert_eq!(parse_version("nope"), None);
        assert!(parse_version("git version 2.30.1").unwrap() < MINIMUM_VERSION);
        assert!(parse_version("git version 2.36.0").unwrap() >= MINIMUM_VERSION);
        assert!(parse_version("git version 3.1").unwrap() >= MINIMUM_VERSION);
    }

    #[test]
    fn only_absolute_candidates() {
        assert!(candidates().iter().all(|candidate| candidate.is_absolute()));
    }
}
