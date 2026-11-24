//! Checks for values that reach Git as arguments.

use crate::error::{AppError, AppResult};

pub const MAX_FILTER_REFS: usize = 200;
const MAX_REF_LENGTH: usize = 1024;
const MAX_PATH_LENGTH: usize = 4096;
pub const MAX_MESSAGE_LENGTH: usize = 64 * 1024;

pub fn hash(value: &str) -> AppResult<()> {
    let valid_length = value.len() == 40 || value.len() == 64;
    if valid_length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        Err(AppError::invalid("Invalid commit ID."))
    }
}

fn has_control(value: &str) -> bool {
    value.chars().any(|c| c.is_control())
}

/// A history filter entry: `HEAD` or a full ref name under `refs/`.
pub fn filter_ref(value: &str) -> AppResult<()> {
    let shaped = value == "HEAD" || value.starts_with("refs/");
    if shaped
        && value.len() <= MAX_REF_LENGTH
        && !has_control(value)
        && !value.chars().any(char::is_whitespace)
    {
        Ok(())
    } else {
        Err(AppError::invalid(format!(
            "Invalid history filter \u{201c}{value}\u{201d}."
        )))
    }
}

pub fn filter_refs(values: &[String]) -> AppResult<()> {
    if values.len() > MAX_FILTER_REFS {
        return Err(AppError::invalid(
            "Too many branches in the history filter.",
        ));
    }
    values.iter().try_for_each(|value| filter_ref(value))
}

/// Shape check before `git check-ref-format` runs: no option-like or multi-line names.
pub fn branch_name_shape(name: &str) -> AppResult<()> {
    if name.is_empty() || name.starts_with('-') || has_control(name) || name.len() > MAX_REF_LENGTH
    {
        return Err(AppError::invalid("Enter a valid branch name."));
    }
    Ok(())
}

/// A repository-relative path from the UI: plain components only. Backslashes and drive
/// letters are refused everywhere; colons too on Windows, and a leading colon (pathspec magic)
/// everywhere. On macOS and Linux a colon inside a name is an ordinary character.
pub fn relative_path(path: &str) -> AppResult<()> {
    let invalid = || AppError::invalid("Invalid file path.");
    let drive =
        path.len() >= 2 && path.as_bytes()[1] == b':' && path.as_bytes()[0].is_ascii_alphabetic();
    let colon = if cfg!(windows) {
        path.contains(':')
    } else {
        path.starts_with(':')
    };
    if path.is_empty()
        || path.len() > MAX_PATH_LENGTH
        || path.chars().any(|c| c.is_control() || c == '\\')
        || drive
        || colon
    {
        return Err(invalid());
    }
    let trimmed = path.strip_suffix('/').unwrap_or(path);
    let plain = std::path::Path::new(trimmed)
        .components()
        .all(|part| matches!(part, std::path::Component::Normal(_)));
    if !plain
        || trimmed
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(invalid());
    }
    Ok(())
}

pub fn message(text: &str) -> AppResult<()> {
    if text.len() > MAX_MESSAGE_LENGTH || text.contains('\0') {
        return Err(AppError::invalid(
            "The message is too long or contains a NUL byte.",
        ));
    }
    Ok(())
}

/// `stash@{n}`.
pub fn stash_name(value: &str) -> AppResult<()> {
    let digits = value
        .strip_prefix("stash@{")
        .and_then(|rest| rest.strip_suffix('}'))
        .filter(|digits| !digits.is_empty() && digits.len() < 10);
    match digits {
        Some(digits) if digits.bytes().all(|b| b.is_ascii_digit()) => Ok(()),
        _ => Err(AppError::invalid("Select a stash.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_must_be_full_lowercase_hex() {
        assert!(hash(&"a".repeat(40)).is_ok());
        assert!(hash(&"0".repeat(64)).is_ok());
        assert!(hash("abc").is_err());
        assert!(hash(&"A".repeat(40)).is_err());
        assert!(hash(&format!("--{}", "a".repeat(38))).is_err());
    }

    #[test]
    fn filters_reject_options_and_whitespace() {
        assert!(filter_ref("HEAD").is_ok());
        assert!(filter_ref("refs/heads/feature/x").is_ok());
        assert!(filter_ref("--all").is_err());
        assert!(filter_ref("refs/heads/a b").is_err());
        assert!(filter_ref("main").is_err());
        assert!(filter_refs(&vec!["HEAD".to_string(); MAX_FILTER_REFS + 1]).is_err());
    }

    #[test]
    fn paths_and_stashes() {
        assert!(relative_path("src/a [b].ts").is_ok());
        assert!(relative_path("../etc/passwd").is_err());
        assert!(relative_path("/abs").is_err());
        assert!(relative_path("").is_err());
        assert!(
            relative_path("nested/").is_ok(),
            "untracked nested repositories end in a slash"
        );
        for bad in [
            "a/../b", "./a", "a//b", "a\\b", "C:/x", "c:x", ":(top)x", "a\nb", "/x",
        ] {
            assert!(relative_path(bad).is_err(), "{bad:?}");
        }
        assert!(stash_name("stash@{12}").is_ok());
        assert!(stash_name("stash@{}").is_err());
        assert!(stash_name("stash@{1}x").is_err());
        assert!(branch_name_shape("-x").is_err());
        assert!(branch_name_shape("a\nb").is_err());
    }
}
