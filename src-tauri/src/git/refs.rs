//! Worktrees, refs, upstream tracking and stopped operations.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::thread;

use super::models::{RefKind, Reference, Tracking, Worktree};
use super::runner::{Git, RunOptions};
use crate::error::AppResult;

const REF_PREFIXES: &[(&str, RefKind)] = &[
    ("refs/heads/", RefKind::Local),
    ("refs/remotes/", RefKind::Remote),
    ("refs/tags/", RefKind::Tag),
];
const REF_FORMAT: &str =
    "--format=%(refname)%00%(HEAD)%00%(worktreepath)%00%(symref)%00%(objectname)%00%(*objectname)";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub ahead: u32,
    pub behind: u32,
}

/// A worktree entry from `git worktree list` before counts are read.
struct Entry {
    path: String,
    branch: Option<String>,
    unavailable: bool,
}

impl Git {
    /// Every worktree of the repository, main first, with change and upstream counts. A
    /// worktree whose folder belongs to another repository, or whose top level is somewhere
    /// else (`core.worktree`), is marked unavailable so it is never used.
    pub fn worktrees(&self) -> AppResult<Vec<Worktree>> {
        let output = self.run(
            &["worktree", "list", "--porcelain", "-z"],
            RunOptions::default(),
        )?;
        let entries: Vec<Entry> = output.split("\0\0").filter_map(parse_entry).collect();
        let upstreams = self.upstream_counts()?;
        let common = self.common_dir()?;
        let checked: Vec<(bool, Option<u32>)> = entries
            .chunks(PARALLEL_STATUS)
            .flat_map(|batch| {
                thread::scope(|scope| {
                    let handles: Vec<_> = batch
                        .iter()
                        .map(|entry| scope.spawn(|| inspect(entry, &common)))
                        .collect();
                    handles
                        .into_iter()
                        .map(|handle| handle.join().unwrap_or((false, None)))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        Ok(entries
            .into_iter()
            .zip(checked)
            .enumerate()
            .map(|(position, (entry, (usable, changes)))| {
                let counts = entry
                    .branch
                    .as_ref()
                    .and_then(|b| upstreams.get(b))
                    .copied();
                Worktree {
                    name: folder_name(&entry.path),
                    is_main: position == 0,
                    changes,
                    ahead: counts.map(|c| c.ahead),
                    behind: counts.map(|c| c.behind),
                    path: entry.path,
                    branch: entry.branch,
                    unavailable: !usable,
                }
            })
            .collect())
    }

    /// Absolute path of the repository's common Git folder.
    pub fn common_dir(&self) -> AppResult<PathBuf> {
        let output = self.run(
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
            RunOptions::default(),
        )?;
        let path = PathBuf::from(output.trim_end_matches(['\n', '\r']));
        Ok(dunce::canonicalize(&path).unwrap_or(path))
    }

    /// The top folder of the worktree that contains `self.path()`.
    pub fn worktree_root(&self) -> AppResult<String> {
        let output = self.run(&["rev-parse", "--show-toplevel"], RunOptions::default())?;
        Ok(output.trim_end_matches(['\n', '\r']).to_string())
    }

    pub fn references(&self) -> AppResult<Vec<Reference>> {
        let refs = self.run(
            &[
                "for-each-ref",
                REF_FORMAT,
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ],
            RunOptions::default(),
        )?;
        let stashes = self.run(
            &["stash", "list", "-z", "--format=%gd%x1f%H%x1f%gs"],
            RunOptions::default(),
        )?;
        Ok(refs
            .lines()
            .filter_map(parse_reference)
            .chain(stashes.split('\0').filter_map(parse_stash))
            .collect())
    }

    pub fn remotes(&self) -> AppResult<Vec<String>> {
        let output = self.run(&["remote"], RunOptions::default())?;
        Ok(output.lines().map(str::to_string).collect())
    }

    /// Upstream of the checked-out branch, when it has one that exists.
    pub fn tracking(&self) -> AppResult<Option<Tracking>> {
        let head = self.run(
            &["symbolic-ref", "--quiet", "HEAD"],
            RunOptions::accepting(&[0, 1]),
        )?;
        let head = head.trim();
        let Some(branch) = head.strip_prefix("refs/heads/") else {
            return Ok(None);
        };
        let fields = self.run(
            &[
                "for-each-ref",
                "--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)",
                head,
            ],
            RunOptions::default(),
        )?;
        let parts: Vec<&str> = fields.trim_end().split('\0').collect();
        let [remote, target, upstream] = parts[..] else {
            return Ok(None);
        };
        if remote.is_empty() || !target.starts_with("refs/heads/") || upstream.is_empty() {
            return Ok(None);
        }
        if self.resolve_commit(upstream)?.is_none() {
            return Ok(None);
        }
        let range = format!("HEAD...{upstream}");
        let counts = self.run(
            &["rev-list", "--left-right", "--count", &range, "--"],
            RunOptions::default(),
        )?;
        let numbers: Vec<u32> = counts
            .split_whitespace()
            .filter_map(|n| n.parse().ok())
            .collect();
        let [ahead, behind] = numbers[..] else {
            return Ok(None);
        };
        Ok(Some(Tracking {
            branch: branch.to_string(),
            remote: remote.to_string(),
            target: target.to_string(),
            ahead,
            behind,
        }))
    }

    /// Ahead and behind counts for every local branch with an upstream, from one `for-each-ref`.
    fn upstream_counts(&self) -> AppResult<HashMap<String, Counts>> {
        let output = self.run(
            &[
                "for-each-ref",
                "--format=%(refname:lstrip=2)%00%(upstream)%00%(upstream:track,nobracket)",
                "refs/heads",
            ],
            RunOptions::default(),
        )?;
        Ok(output
            .lines()
            .filter_map(|line| {
                let fields: Vec<&str> = line.split('\0').collect();
                let [name, upstream, track] = fields[..] else {
                    return None;
                };
                (!upstream.is_empty() && track != "gone")
                    .then(|| (name.to_string(), parse_track(track)))
            })
            .collect())
    }
}

/// Worktrees whose status is read at the same time.
const PARALLEL_STATUS: usize = 4;

/// Whether the entry is a usable worktree of this repository, and its change count.
fn inspect(entry: &Entry, common: &Path) -> (bool, Option<u32>) {
    if entry.unavailable {
        return (false, None);
    }
    let git = Git::new(&entry.path);
    if !belongs(&git, &entry.path, common) {
        log::warn!(
            "ignoring worktree {} of another repository or folder",
            entry.path
        );
        return (false, None);
    }
    (true, git.change_count().ok())
}

fn belongs(git: &Git, path: &str, common: &Path) -> bool {
    let Ok(output) = git.run(
        &[
            "rev-parse",
            "--path-format=absolute",
            "--show-toplevel",
            "--git-common-dir",
        ],
        RunOptions::default(),
    ) else {
        return false;
    };
    let lines: Vec<&str> = output.lines().map(|l| l.trim_end_matches('\r')).collect();
    let [top, dir] = lines[..] else {
        return false;
    };
    let canonical = |p: &str| dunce::canonicalize(p).ok();
    canonical(top).is_some_and(|top| Some(top) == canonical(path))
        && canonical(dir).is_some_and(|dir| dir == common)
}

fn parse_entry(record: &str) -> Option<Entry> {
    let fields: Vec<&str> = record.split('\0').filter(|f| !f.is_empty()).collect();
    let path = fields.first()?.strip_prefix("worktree ")?.to_string();
    let branch = fields
        .iter()
        .find_map(|f| f.strip_prefix("branch refs/heads/"))
        .map(str::to_string);
    let flagged = fields
        .iter()
        .any(|f| f.starts_with("prunable") || *f == "bare");
    let unavailable = flagged || !Path::new(&path).is_dir();
    Some(Entry {
        path,
        branch,
        unavailable,
    })
}

/// Last path component, accepting both separators.
pub fn folder_name(path: &str) -> String {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .to_string()
}

fn parse_reference(line: &str) -> Option<Reference> {
    let fields: Vec<&str> = line.split('\0').collect();
    let [id, head, worktree, symref, object, peeled] = fields[..] else {
        return None;
    };
    if !symref.is_empty() {
        return None;
    }
    let (prefix, kind) = REF_PREFIXES.iter().find(|(p, _)| id.starts_with(p))?;
    let target = if peeled.is_empty() { object } else { peeled };
    Some(Reference {
        id: id.to_string(),
        name: id[prefix.len()..].to_string(),
        kind: *kind,
        target: (!target.is_empty()).then(|| target.to_string()),
        is_head: head == "*",
        worktree_path: (!worktree.is_empty()).then(|| worktree.to_string()),
        subject: None,
    })
}

fn parse_stash(record: &str) -> Option<Reference> {
    let fields: Vec<&str> = record
        .trim_start_matches('\n')
        .splitn(3, '\u{1f}')
        .collect();
    let [name, hash, subject] = fields[..] else {
        return None;
    };
    Some(Reference {
        id: name.to_string(),
        name: name.to_string(),
        kind: RefKind::Stash,
        target: Some(hash.to_string()),
        is_head: false,
        worktree_path: None,
        subject: Some(subject.to_string()),
    })
}

/// Parses `ahead 2, behind 1` as printed by `%(upstream:track,nobracket)`.
pub fn parse_track(text: &str) -> Counts {
    text.split(", ").fold(Counts::default(), |counts, part| {
        let words: Vec<&str> = part.split(' ').collect();
        match words[..] {
            ["ahead", n] => Counts {
                ahead: n.parse().unwrap_or(0),
                ..counts
            },
            ["behind", n] => Counts {
                behind: n.parse().unwrap_or(0),
                ..counts
            },
            _ => counts,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn track_and_names() {
        assert_eq!(
            parse_track("ahead 2, behind 1"),
            Counts {
                ahead: 2,
                behind: 1
            }
        );
        assert_eq!(
            parse_track("behind 4"),
            Counts {
                ahead: 0,
                behind: 4
            }
        );
        assert_eq!(parse_track(""), Counts::default());
        assert_eq!(folder_name("C:/work/app-feature/"), "app-feature");
        assert_eq!(folder_name(r"C:\work\app"), "app");
    }

    #[test]
    fn references_skip_symbolic_refs() {
        let line = "refs/remotes/origin/HEAD\0 \0\0refs/remotes/origin/main\0abc\0";
        assert!(parse_reference(line).is_none());
        let tag = parse_reference("refs/tags/v1\0 \0\0\0tagobj\0commit").unwrap();
        assert_eq!(tag.target.as_deref(), Some("commit"));
        assert_eq!(tag.kind, RefKind::Tag);
    }
}
