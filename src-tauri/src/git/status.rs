//! Working-tree status, commit file lists and diffs.

use std::collections::BTreeSet;

use super::conflicts::ConflictKind;
use super::models::{ChangeKind, ChangedFile, FileDiff};
use super::runner::{Git, RunOptions};
use super::validate;
use crate::error::{AppError, AppResult, ErrorKind};

/// Fixed diff output whatever the repository or user configures (colour, context, prefixes,
/// renames), because hunk and line staging rebuild patches from this text.
pub const DIFF_OPTIONS: &[&str] = &[
    "--no-color",
    "--unified=3",
    "--inter-hunk-context=0",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "--no-relative",
    "--src-prefix=a/",
    "--dst-prefix=b/",
];
/// Diffs larger than this are cut, so a generated file cannot flood the UI.
pub const MAX_DIFF_BYTES: usize = 4 * 1024 * 1024;
/// `git status` output kept; a work tree with more changes than this is refused.
const STATUS_OUTPUT_LIMIT: usize = 32 * 1024 * 1024;

impl Git {
    pub fn working_files(&self) -> AppResult<Vec<ChangedFile>> {
        let options = RunOptions {
            output_limit: STATUS_OUTPUT_LIMIT,
            ..RunOptions::default()
        };
        let output = self.run(
            &[
                "status",
                "--porcelain=v1",
                "-z",
                "--no-renames",
                "--untracked-files=all",
            ],
            options,
        )?;
        Ok(output.split('\0').flat_map(parse_status_record).collect())
    }

    /// Number of distinct changed paths.
    pub fn change_count(&self) -> AppResult<u32> {
        let files = self.working_files()?;
        let paths: BTreeSet<&str> = files.iter().map(|file| file.path.as_str()).collect();
        Ok(u32::try_from(paths.len()).unwrap_or(u32::MAX))
    }

    pub fn commit_files(&self, hash: &str) -> AppResult<Vec<ChangedFile>> {
        validate::hash(hash)?;
        let output = self.run(
            &[
                "show",
                "--format=",
                "--diff-merges=first-parent",
                "--no-ext-diff",
                "--no-textconv",
                "--no-renames",
                "--name-status",
                "-z",
                hash,
                "--",
            ],
            RunOptions::default(),
        )?;
        let records: Vec<&str> = output.split('\0').filter(|r| !r.is_empty()).collect();
        Ok(records
            .as_chunks::<2>()
            .0
            .iter()
            .map(|[status, path]| ChangedFile {
                path: path.to_string(),
                kind: ChangeKind::Committed,
                status: status.chars().take(1).collect(),
                conflict: None,
            })
            .collect())
    }

    /// Diff of one file. `commit` is required for committed files.
    pub fn diff(
        &self,
        file: &ChangedFile,
        commit: Option<&str>,
        ignore_whitespace: bool,
    ) -> AppResult<FileDiff> {
        self.diff_unchecked(file, commit, ignore_whitespace)
            .map_err(missing_objects)
    }

    fn diff_unchecked(
        &self,
        file: &ChangedFile,
        commit: Option<&str>,
        ignore_whitespace: bool,
    ) -> AppResult<FileDiff> {
        validate::relative_path(&file.path)?;
        let mut options: Vec<&str> = DIFF_OPTIONS.to_vec();
        if ignore_whitespace {
            options.push("--ignore-all-space");
        }
        let bytes = match file.kind {
            ChangeKind::Staged => self.diff_paths(&["diff", "--cached"], &options, file)?,
            ChangeKind::Unstaged => self.diff_paths(&["diff"], &options, file)?,
            ChangeKind::Untracked => self.untracked_diff(&options, file)?,
            ChangeKind::Committed => {
                let commit =
                    commit.ok_or_else(|| AppError::invalid("Select a commit to view its diff."))?;
                validate::hash(commit)?;
                let prefix = ["show", "--format=", "--diff-merges=first-parent"];
                let args = [&prefix[..], &options, &[commit, "--", &file.path]].concat();
                self.run_capped(&args, diff_options().literal())?
            }
        };
        Ok(decode_diff(bytes.0, bytes.1))
    }

    fn diff_paths(
        &self,
        command: &[&str],
        options: &[&str],
        file: &ChangedFile,
    ) -> AppResult<(Vec<u8>, bool)> {
        let args = [command, options, &["--", &file.path]].concat();
        self.run_capped(&args, diff_options().literal())
    }

    /// Diff of an untracked file against nothing. The path must be listed as untracked and
    /// stay inside the worktree; links and very large files are described, not read.
    fn untracked_diff(&self, options: &[&str], file: &ChangedFile) -> AppResult<(Vec<u8>, bool)> {
        let listed = self.working_files()?.iter().any(|f| f == file);
        if !listed {
            return Err(AppError::stale(
                "The file status changed. Refresh and try again.",
            ));
        }
        if file.path.ends_with('/') {
            return Ok((
                format!("Untracked nested repository: {}\n", file.path).into_bytes(),
                false,
            ));
        }
        let location = self.path().join(&file.path);
        let metadata = std::fs::symlink_metadata(&location)
            .map_err(|_| AppError::stale("The file is gone. Refresh and try again."))?;
        if metadata.file_type().is_symlink() {
            let target = std::fs::read_link(&location)
                .map(|t| t.display().to_string())
                .unwrap_or_default();
            return Ok((
                format!("Untracked symbolic link to {target}\n").into_bytes(),
                false,
            ));
        }
        self.file_in_worktree(&file.path)?;
        if metadata.len() > MAX_DIFF_BYTES as u64 {
            let size = metadata.len() as f64 / (1024.0 * 1024.0);
            return Ok((
                format!("Untracked file of {size:.1} MB, too large to show.\n").into_bytes(),
                true,
            ));
        }
        let target = format!("./{}", file.path);
        let args = [
            &["diff", "--no-index"][..],
            options,
            &["--", "/dev/null", &target],
        ]
        .concat();
        self.run_capped(&args, RunOptions::accepting(&[0, 1]).capped(MAX_DIFF_BYTES))
    }
}

fn parse_status_record(record: &str) -> Vec<ChangedFile> {
    let mut chars = record.chars();
    let (Some(x), Some(y), Some(' ')) = (chars.next(), chars.next(), chars.next()) else {
        return Vec::new();
    };
    let path = chars.as_str();
    if path.is_empty() {
        return Vec::new();
    }
    let file = |kind, status: &str| ChangedFile {
        path: path.to_string(),
        kind,
        status: status.to_string(),
        conflict: None,
    };
    if x == '?' {
        return vec![file(ChangeKind::Untracked, "?")];
    }
    if x == '!' {
        return Vec::new();
    }
    if let Some(conflict) = ConflictKind::from_code(&format!("{x}{y}")) {
        let unmerged = ChangedFile {
            conflict: Some(conflict),
            ..file(ChangeKind::Unstaged, "U")
        };
        return vec![unmerged];
    }
    [(x, ChangeKind::Staged), (y, ChangeKind::Unstaged)]
        .into_iter()
        .filter(|(code, _)| *code != ' ')
        .map(|(code, kind)| file(kind, &code.to_string()))
        .collect()
}

/// Git's errors for content a partial clone has not downloaded. Reading commands never fetch
/// (see the runner), so these are reported in plain words instead.
const MISSING_OBJECT_MARKERS: &[&str] = &["from promisor remote", "lazy fetching disabled"];

fn missing_objects(error: AppError) -> AppError {
    if MISSING_OBJECT_MARKERS
        .iter()
        .any(|m| error.message.contains(m))
    {
        return AppError::new(
            ErrorKind::MissingObjects,
            "The content of this file has not been downloaded yet: the repository is a partial clone, and ratelgit never fetches while reading. Fetch it in a terminal (for example `git fetch` or `git checkout` of that commit) to see this diff.",
        );
    }
    error
}

fn diff_options() -> RunOptions<'static> {
    RunOptions::default().capped(MAX_DIFF_BYTES)
}

/// Decodes a diff, marking lossy decoding and cutting oversized output at a line boundary.
pub fn decode_diff(mut bytes: Vec<u8>, cut: bool) -> FileDiff {
    let truncated = cut || bytes.len() > MAX_DIFF_BYTES;
    if truncated {
        // Keep whole lines only; the output may stop in the middle of one.
        let end = bytes.len().min(MAX_DIFF_BYTES);
        let keep = bytes[..end]
            .iter()
            .rposition(|b| *b == b'\n')
            .map_or(end, |position| position + 1);
        bytes.truncate(keep);
    }
    match String::from_utf8(bytes) {
        Ok(text) => FileDiff {
            text,
            lossy: false,
            truncated,
        },
        Err(error) => FileDiff {
            text: String::from_utf8_lossy(error.as_bytes()).into_owned(),
            lossy: true,
            truncated,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_records_split_staged_and_unstaged_sides() {
        let files = parse_status_record("MM src/a.ts");
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].kind, ChangeKind::Staged);
        assert_eq!(files[1].kind, ChangeKind::Unstaged);
        assert_eq!(parse_status_record("UU c.txt")[0].status, "U");
        assert_eq!(
            parse_status_record("DU c.txt")[0].conflict,
            Some(ConflictKind::DeletedByUs)
        );
        assert_eq!(
            parse_status_record("?? new [file].txt")[0].path,
            "new [file].txt"
        );
        assert!(parse_status_record("").is_empty());
    }

    #[test]
    fn oversized_and_invalid_diffs_are_flagged() {
        let plain = decode_diff(b"+ok\n".to_vec(), false);
        assert!(!plain.lossy && !plain.truncated);
        let lossy = decode_diff(vec![b'+', 0xff, b'\n'], false);
        assert!(lossy.lossy);
        assert!(decode_diff(b"+ok\n".to_vec(), true).truncated);
        let big = decode_diff(b"+line\n".repeat(MAX_DIFF_BYTES / 6 + 10), false);
        assert!(big.truncated);
        assert!(big.text.ends_with('\n'));
        assert!(big.text.len() <= MAX_DIFF_BYTES);
    }
}
