//! Branch, integration, stash and remote actions.

use std::path::{Component, Path, PathBuf};

use super::actions::Action;
use super::runner::{Git, RunOptions, NETWORK_TIMEOUT};
use super::validate;
use crate::error::{AppError, AppResult, ErrorKind};

const LOCAL_PREFIX: &str = "refs/heads/";
const REMOTE_PREFIX: &str = "refs/remotes/";
const NOT_MERGED_MARKER: &str = "not fully merged";

impl Git {
    pub(super) fn execute_reference_action(&self, action: &Action) -> AppResult<()> {
        match action {
            Action::CreateBranch { name } => {
                self.validate_branch_name(name)?;
                self.write(&["switch", "-c", name])
            }
            Action::SwitchBranch { reference } => {
                let name = local_branch_name(reference)?;
                self.write(&["switch", "--", name])
            }
            Action::CheckoutRemote { reference } => self.checkout_remote(reference),
            Action::RenameBranch { reference, name } => {
                let current = local_branch_name(reference)?;
                self.validate_branch_name(name)?;
                self.write(&["branch", "--move", "--", current, name])
            }
            Action::DeleteBranch { reference, force } => self.delete_branch(reference, *force),
            // Full ref names, so a tag with the same name as the branch is never picked.
            Action::Merge { reference } => {
                let name = local_branch_name(reference)?;
                let message = self.merge_message(name)?;
                self.write(&[
                    "merge",
                    "--no-edit",
                    "-m",
                    &message,
                    "--end-of-options",
                    reference,
                ])
            }
            Action::Rebase { reference } => {
                local_branch_name(reference)?;
                self.write(&["rebase", "--no-autostash", "--end-of-options", reference])
            }
            Action::AddWorktree { .. } => Err(AppError::invalid(
                "The new worktree folder must be resolved before it is added.",
            )),
            Action::ApplyStash { stash, revision } => {
                self.expect_stash(stash, revision)?;
                self.write(&["stash", "apply", revision])
            }
            Action::DropStash { stash, revision } => {
                // `stash drop` only takes an index, so the index must still name the same commit.
                self.expect_stash(stash, revision)?;
                self.write(&["stash", "drop", "--quiet", stash])
            }
            Action::Fetch {} => self.network(&["fetch", "--all", "--no-recurse-submodules"]),
            Action::Pull {} | Action::Push {} => self.sync(matches!(action, Action::Push {})),
            _ => Err(AppError::invalid("Unsupported action.")),
        }
    }

    /// Checks out a local branch in a new worktree at `location` (absolute, not yet used).
    /// `git worktree add` prefers the branch over a tag of the same name.
    pub fn add_worktree(&self, reference: &str, location: &Path) -> AppResult<()> {
        let name = local_branch_name(reference)?;
        if !location.is_absolute() || is_unc(location) {
            return Err(AppError::invalid(
                "Choose a folder on a local drive for the new worktree.",
            ));
        }
        let location = location.to_string_lossy();
        self.write(&["worktree", "add", "--", &location, name])
    }

    /// Git's usual message, which it would otherwise spell with the full ref name.
    fn merge_message(&self, name: &str) -> AppResult<String> {
        let current = self.run(
            &["symbolic-ref", "--quiet", "--short", "HEAD"],
            RunOptions::accepting(&[0, 1]),
        )?;
        let current = current.trim();
        Ok(match current {
            "" | "main" | "master" => format!("Merge branch '{name}'"),
            other => format!("Merge branch '{name}' into {other}"),
        })
    }

    fn write(&self, args: &[&str]) -> AppResult<()> {
        self.run(args, RunOptions::writing()).map(|_| ())
    }

    fn network(&self, args: &[&str]) -> AppResult<()> {
        let options = RunOptions {
            timeout: NETWORK_TIMEOUT,
            ..RunOptions::writing()
        };
        self.run(args, options).map(|_| ())
    }

    /// Rejects names Git would read as options or that `check-ref-format` refuses.
    pub fn validate_branch_name(&self, name: &str) -> AppResult<()> {
        validate::branch_name_shape(name)?;
        let full = format!("{LOCAL_PREFIX}{name}");
        self.run(&["check-ref-format", &full], RunOptions::default())
            .map(|_| ())
            .map_err(|_| {
                AppError::invalid(format!(
                    "\u{201c}{name}\u{201d} is not a valid branch name."
                ))
            })
    }

    fn delete_branch(&self, reference: &str, force: bool) -> AppResult<()> {
        let name = local_branch_name(reference)?;
        let flag = if force { "-D" } else { "-d" };
        self.write(&["branch", flag, "--", name]).map_err(|error| {
            match error.message.contains(NOT_MERGED_MARKER) {
                true => AppError::new(ErrorKind::NotFullyMerged, error.message),
                false => error,
            }
        })
    }

    /// Local name for a remote branch: `origin/feature/x` becomes `feature/x`.
    pub fn tracking_name(&self, reference: &str) -> AppResult<String> {
        validate::filter_ref(reference)?;
        let name = reference
            .strip_prefix(REMOTE_PREFIX)
            .ok_or_else(|| AppError::invalid("Select a remote branch."))?;
        let remote = self
            .remotes()?
            .into_iter()
            .filter(|remote| name.starts_with(&format!("{remote}/")))
            .max_by_key(String::len)
            .ok_or_else(|| AppError::invalid(format!("No remote matches {name}.")))?;
        let local = name[remote.len() + 1..].to_string();
        self.validate_branch_name(&local)?;
        Ok(local)
    }

    fn checkout_remote(&self, reference: &str) -> AppResult<()> {
        let local = self.tracking_name(reference)?;
        self.write(&[
            "switch",
            "--track",
            "-c",
            &local,
            "--end-of-options",
            reference,
        ])
    }

    fn expect_stash(&self, stash: &str, revision: &str) -> AppResult<()> {
        validate::stash_name(stash)?;
        validate::hash(revision)?;
        if self.resolve_commit(stash)?.as_deref() != Some(revision) {
            return Err(AppError::stale(
                "The stash list changed. Refresh and try again.",
            ));
        }
        Ok(())
    }

    fn sync(&self, push: bool) -> AppResult<()> {
        let upstream = self
            .tracking()?
            .filter(|tracking| tracking.remote != ".")
            .ok_or_else(|| {
                AppError::invalid("Configure a remote upstream for this branch before syncing.")
            })?;
        if push {
            let refspec = format!("{LOCAL_PREFIX}{}:{}", upstream.branch, upstream.target);
            return self.network(&[
                "push",
                "--no-follow-tags",
                "--no-recurse-submodules",
                "--",
                &upstream.remote,
                &refspec,
            ]);
        }
        self.network(&[
            "pull",
            "--ff-only",
            "--no-rebase",
            "--no-autostash",
            "--no-recurse-submodules",
            "--",
            &upstream.remote,
            &upstream.target,
        ])
    }
}

/// `refs/heads/<name>` to `<name>`, refusing anything else.
pub fn local_branch_name(reference: &str) -> AppResult<&str> {
    validate::filter_ref(reference)?;
    reference
        .strip_prefix(LOCAL_PREFIX)
        .filter(|name| !name.is_empty() && !name.starts_with('-'))
        .ok_or_else(|| AppError::invalid("Select a local branch."))
}

/// Windows UNC and verbatim paths (`\\\\server\\share`, `\\\\?\\C:\\`) are refused.
pub fn is_unc(path: &Path) -> bool {
    let text = path.to_string_lossy();
    text.starts_with("\\\\") || text.starts_with("//")
}

/// Device names Windows reserves (also with an extension, such as `con.txt`) and names that
/// end in a dot or space. Refused on every platform so a project works on both.
fn reserved_on_windows(name: &str) -> bool {
    if name.ends_with('.') || name.ends_with(' ') {
        return true;
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or(name)
        .trim_end()
        .to_ascii_uppercase();
    let numbered = |prefix: &str| {
        stem.strip_prefix(prefix)
            .is_some_and(|n| n.len() == 1 && n.as_bytes()[0].is_ascii_digit() && n != "0")
    };
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") || numbered("COM") || numbered("LPT")
}

/// The new worktree folder: `name` (one plain folder name) inside `parent`.
pub fn child_folder(parent: &Path, name: &str) -> AppResult<PathBuf> {
    let name = name.trim();
    let invalid = || AppError::invalid("Enter a folder name without slashes for the new worktree.");
    let plain = !name.is_empty()
        && name.len() <= 255
        && name != "."
        && name != ".."
        && !name.starts_with('-')
        && !name
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'));
    if !plain {
        return Err(invalid());
    }
    if reserved_on_windows(name) {
        return Err(AppError::invalid(
            "This folder name is reserved on Windows. Choose another name.",
        ));
    }
    let parts: Vec<Component> = Path::new(name).components().collect();
    if !matches!(parts[..], [Component::Normal(_)]) {
        return Err(invalid());
    }
    if !parent.is_absolute() || is_unc(parent) {
        return Err(AppError::invalid(
            "Choose a folder on a local drive for the new worktree.",
        ));
    }
    Ok(parent.join(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_names_and_worktree_folders() {
        assert_eq!(local_branch_name("refs/heads/fix/a").unwrap(), "fix/a");
        assert!(local_branch_name("refs/tags/v1").is_err());
        assert!(local_branch_name("refs/heads/-x").is_err());
        let parent = std::env::temp_dir();
        assert_eq!(
            child_folder(&parent, " app-fix ").unwrap(),
            parent.join("app-fix")
        );
        for bad in ["", ".", "..", "a/b", "a\\b", "-x", "C:x", "a\nb"] {
            assert!(child_folder(&parent, bad).is_err(), "{bad:?}");
        }
        assert!(child_folder(Path::new("relative"), "x").is_err());
        // Names Windows reserves are refused everywhere, so a project works on both.
        for reserved in [
            "CON", "prn", "Aux", "nul", "COM1", "lpt9", "con.txt", "name.", "name .",
        ] {
            assert!(child_folder(&parent, reserved).is_err(), "{reserved:?}");
        }
        assert!(child_folder(&parent, "console").is_ok());
        assert!(child_folder(&parent, "com10").is_ok());
        assert!(is_unc(Path::new("\\\\server\\share")));
        assert!(is_unc(Path::new("\\\\?\\C:\\work")));
        assert!(!is_unc(&parent));
    }
}
