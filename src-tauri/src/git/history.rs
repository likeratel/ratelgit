//! Topologically ordered history pages for the graph.

use super::models::{CommitDetail, CommitLine, HistoryPage};
use super::runner::{Git, RunOptions};
use super::validate;
use crate::error::{AppError, AppResult};

pub const HISTORY_PAGE_SIZE: usize = 500;
const MAX_PAGE_SIZE: usize = 5000;
const FIELD: char = '\u{1f}';
const LOG_FORMAT: &str = "--format=%H%x1f%h%x1f%D%x1f%P%x1f%aN%x1f%as%x1f%at%x1f%s";
const LOG_FIELDS: usize = 8;

/// Which refs the graph walks from: every branch, remote and tag when empty, otherwise only
/// commits reachable from the listed refs (full names or `HEAD`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Scope(pub Vec<String>);

impl Scope {
    pub fn all() -> Self {
        Self(Vec::new())
    }

    pub fn is_all(&self) -> bool {
        self.0.is_empty()
    }
}

impl Git {
    /// One page of history. Pages share one ordering, so `skip` continues a listing.
    pub fn history(&self, scope: &Scope, skip: usize, limit: usize) -> AppResult<HistoryPage> {
        let limit = limit.clamp(1, MAX_PAGE_SIZE);
        let Some(arguments) = self.scope_arguments(scope)? else {
            return Ok(HistoryPage {
                lines: Vec::new(),
                complete: true,
            });
        };
        let lines = self.page(&arguments, skip, limit)?;
        let complete = lines.len() < limit;
        Ok(HistoryPage { lines, complete })
    }

    /// True when the checked-out commit is not reachable from the filtered refs.
    pub fn head_hidden(&self, scope: &Scope) -> AppResult<bool> {
        if scope.is_all() || scope.0.iter().any(|r| r == "HEAD") {
            return Ok(false);
        }
        validate::filter_refs(&scope.0)?;
        if self.resolve_commit("HEAD")?.is_none() {
            return Ok(false);
        }
        let existing = self.existing(&scope.0)?;
        let args = [
            &["rev-list", "-n", "1", "HEAD", "--not"][..],
            &existing,
            &["--"],
        ]
        .concat();
        Ok(!self.run(&args, RunOptions::default())?.trim().is_empty())
    }

    pub fn commit_detail(&self, hash: &str) -> AppResult<CommitDetail> {
        validate::hash(hash)?;
        let output = self.run(
            &[
                "show",
                "-s",
                "--format=%H%x00%P%x00%aN%x00%aE%x00%aI%x00%B",
                hash,
                "--",
            ],
            RunOptions::default(),
        )?;
        let fields: Vec<&str> = output.split('\0').collect();
        let [hash, parents, author, email, date, message] = fields[..] else {
            return Err(AppError::git(format!(
                "Could not read commit {}.",
                &hash[..8]
            )));
        };
        Ok(CommitDetail {
            hash: hash.to_string(),
            parents: parents.split_whitespace().map(str::to_string).collect(),
            author: author.to_string(),
            email: email.to_string(),
            date: date.to_string(),
            message: message.trim().to_string(),
        })
    }

    /// Full commit ID a revision names, or `None` (unborn HEAD, deleted ref).
    pub fn resolve_commit(&self, revision: &str) -> AppResult<Option<String>> {
        let spec = format!("{revision}^{{commit}}");
        let output = self.run(
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                "--end-of-options",
                &spec,
            ],
            RunOptions::accepting(&[0, 1]),
        )?;
        let resolved = output.trim();
        Ok((!resolved.is_empty()).then(|| resolved.to_string()))
    }

    /// The refs of `refs` that exist, checked with one `for-each-ref` (plus HEAD).
    fn existing<'a>(&self, refs: &'a [String]) -> AppResult<Vec<&'a str>> {
        let named: Vec<&str> = refs
            .iter()
            .map(String::as_str)
            .filter(|r| *r != "HEAD")
            .collect();
        let mut found = std::collections::HashSet::new();
        if !named.is_empty() {
            let args = [&["for-each-ref", "--format=%(refname)"][..], &named].concat();
            let output = self.run(&args, RunOptions::default())?;
            found.extend(output.lines().map(str::to_string));
        }
        let head = refs.iter().any(|r| r == "HEAD") && self.resolve_commit("HEAD")?.is_some();
        Ok(refs
            .iter()
            .map(String::as_str)
            .filter(|r| {
                if *r == "HEAD" {
                    head
                } else {
                    found.contains(*r)
                }
            })
            .collect())
    }

    /// Revision arguments for `git log`, or `None` when nothing is left to walk.
    fn scope_arguments(&self, scope: &Scope) -> AppResult<Option<Vec<String>>> {
        if scope.is_all() {
            let mut args = vec!["--branches", "--remotes", "--tags", "--end-of-options"];
            if self.resolve_commit("HEAD")?.is_some() {
                args.push("HEAD");
            }
            return Ok(Some(args.into_iter().map(str::to_string).collect()));
        }
        validate::filter_refs(&scope.0)?;
        let existing = self.existing(&scope.0)?;
        if existing.is_empty() {
            return Ok(None);
        }
        let args = std::iter::once("--end-of-options")
            .chain(existing)
            .map(str::to_string)
            .collect();
        Ok(Some(args))
    }

    fn page(&self, revisions: &[String], skip: usize, limit: usize) -> AppResult<Vec<CommitLine>> {
        let skip_arg = format!("--skip={skip}");
        let limit_arg = limit.to_string();
        let mut args = vec![
            "log",
            "-z",
            "--topo-order",
            &skip_arg,
            "-n",
            &limit_arg,
            LOG_FORMAT,
        ];
        args.extend(revisions.iter().map(String::as_str));
        args.push("--");
        let output = self.run(&args, RunOptions::default())?;
        Ok(output
            .split('\0')
            .filter(|record| !record.trim().is_empty())
            .enumerate()
            .filter_map(|(offset, record)| parse_line(record, skip + offset))
            .collect())
    }
}

fn parse_line(record: &str, index: usize) -> Option<CommitLine> {
    let record = record.trim_start_matches('\n');
    let fields: Vec<&str> = record.splitn(LOG_FIELDS, FIELD).collect();
    let [hash, short, decorations, parents, author, date, timestamp, subject] = fields[..] else {
        return None;
    };
    Some(CommitLine {
        index,
        hash: hash.to_string(),
        short_hash: short.to_string(),
        subject: subject.trim_end_matches(['\r', '\n']).to_string(),
        author: author.to_string(),
        date: date.to_string(),
        timestamp: timestamp.parse().unwrap_or(0),
        refs: decorations
            .split(", ")
            .filter(|label| !label.is_empty())
            .map(str::to_string)
            .collect(),
        parents: parents.split_whitespace().map(str::to_string).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_log_record() {
        let record = format!(
            "{h}\u{1f}abc1234\u{1f}HEAD -> main, tag: v1\u{1f}{p} {p}\u{1f}Ann\u{1f}2026-02-01\u{1f}1769904000\u{1f}Fix: a \u{1f} b",
            h = "a".repeat(40),
            p = "b".repeat(40)
        );
        let line = parse_line(&record, 7).unwrap();
        assert_eq!(line.index, 7);
        assert_eq!(line.refs, vec!["HEAD -> main", "tag: v1"]);
        assert_eq!(line.parents.len(), 2);
        assert_eq!(line.subject, "Fix: a \u{1f} b");
        assert_eq!(line.timestamp, 1_769_904_000);
        assert!(parse_line("broken", 0).is_none());
    }
}
