//! A single-file unified diff split into hunks, able to rebuild a patch for a subset of changed
//! lines. Line indices match the UI's `src/lib/patch.ts`, which splits the text the same way.

use std::collections::BTreeSet;
use std::ops::Range;

use crate::error::{AppError, AppResult};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hunk {
    /// Index of the `@@` line.
    pub header: usize,
    pub old_start: usize,
    pub new_start: usize,
    /// Indices of the hunk body lines.
    pub body: Range<usize>,
}

pub struct FilePatch {
    pub lines: Vec<String>,
    pub hunks: Vec<Hunk>,
    header_end: usize,
}

/// Splits on `\n`, dropping the empty piece after a trailing newline. `\r` stays on the line.
pub fn split_lines(text: &str) -> Vec<String> {
    let body = text.strip_suffix('\n').unwrap_or(text);
    if text.is_empty() {
        return Vec::new();
    }
    body.split('\n').map(str::to_string).collect()
}

/// Parses `@@ -a[,b] +c[,d] @@`.
pub fn parse_hunk_header(line: &str) -> Option<(usize, usize)> {
    let rest = line.strip_prefix("@@ -")?;
    let (old, rest) = rest.split_once(" +")?;
    let (new, _) = rest.split_once(" @@")?;
    let start = |range: &str| range.split(',').next()?.parse::<usize>().ok();
    Some((start(old)?, start(new)?))
}

fn is_change(line: &str) -> bool {
    line.starts_with('+') || line.starts_with('-')
}

impl FilePatch {
    pub fn new(text: &str) -> Self {
        let lines = split_lines(text);
        let starts: Vec<usize> = (0..lines.len())
            .filter(|&i| lines[i].starts_with("@@ "))
            .collect();
        let hunks = starts
            .iter()
            .enumerate()
            .filter_map(|(position, &start)| {
                let (old_start, new_start) = parse_hunk_header(&lines[start])?;
                let end = starts.get(position + 1).copied().unwrap_or(lines.len());
                Some(Hunk {
                    header: start,
                    old_start,
                    new_start,
                    body: start + 1..end,
                })
            })
            .collect();
        Self {
            header_end: starts.first().copied().unwrap_or(lines.len()),
            lines,
            hunks,
        }
    }

    /// Patches that create or delete a file can only be applied whole.
    pub fn creates_or_deletes_file(&self) -> bool {
        self.lines[..self.header_end]
            .iter()
            .any(|l| l.starts_with("new file mode") || l.starts_with("deleted file mode"))
    }

    pub fn changed_lines_in(&self, hunk: &Hunk) -> Vec<usize> {
        hunk.body
            .clone()
            .filter(|&i| is_change(&self.lines[i]))
            .collect()
    }

    pub fn changed_lines(&self) -> BTreeSet<usize> {
        self.hunks
            .iter()
            .flat_map(|h| self.changed_lines_in(h))
            .collect()
    }

    /// Builds a patch that applies only `selection`. For `reverse` (unstage or discard)
    /// unselected additions stay as context and unselected removals are dropped; forward
    /// application does the opposite. Mode changes are left out: they belong to whole-file
    /// staging. Fails when the selection has no correct patch, which happens when a line
    /// without a final newline would no longer be the last line of the file.
    pub fn patch(&self, selection: &BTreeSet<usize>, reverse: bool) -> AppResult<String> {
        let all = self.changed_lines();
        let chosen: BTreeSet<usize> = selection.intersection(&all).copied().collect();
        if chosen.is_empty() {
            return Err(AppError::invalid("Select changed lines first."));
        }
        if self.creates_or_deletes_file() && chosen != all {
            return Err(AppError::invalid(
                "A new or deleted file can only be changed as a whole.",
            ));
        }
        let mut shift: isize = 0;
        let mut parts: Vec<String> = self.lines[..self.header_end]
            .iter()
            .filter(|line| !line.starts_with("old mode ") && !line.starts_with("new mode "))
            .cloned()
            .collect();
        for hunk in &self.hunks {
            if !self
                .changed_lines_in(hunk)
                .iter()
                .any(|i| chosen.contains(i))
            {
                continue;
            }
            let body = self.rebuild(hunk, &chosen, reverse);
            check_final_newlines(&body)?;
            let old_count = body.iter().filter(|l| l.kind != '+').count();
            let new_count = body.iter().filter(|l| l.kind != '-').count();
            let (old_start, new_start) = if reverse {
                (offset(hunk.new_start, -shift), hunk.new_start)
            } else {
                (hunk.old_start, offset(hunk.old_start, shift))
            };
            shift += new_count as isize - old_count as isize;
            parts.push(format!(
                "@@ -{old_start},{old_count} +{new_start},{new_count} @@"
            ));
            parts.extend(body.iter().flat_map(PatchLine::render));
        }
        Ok(parts.join("\n") + "\n")
    }

    /// The hunk with only `chosen` changes; each line remembers whether it lacks a newline.
    fn rebuild(&self, hunk: &Hunk, chosen: &BTreeSet<usize>, reverse: bool) -> Vec<PatchLine> {
        let mut result = Vec::new();
        for index in hunk.body.clone() {
            let line = &self.lines[index];
            let Some(kind) = line.chars().next().filter(|c| matches!(c, ' ' | '+' | '-')) else {
                continue;
            };
            let text = line.get(1..).unwrap_or("").to_string();
            let no_newline = self
                .lines
                .get(index + 1)
                .is_some_and(|next| next.starts_with('\\') && index + 1 < hunk.body.end);
            let selected = chosen.contains(&index);
            let kind = match kind {
                '+' if selected => '+',
                '+' if reverse => ' ',
                '+' => continue,
                '-' if selected => '-',
                '-' if reverse => continue,
                '-' => ' ',
                other => other,
            };
            result.push(PatchLine {
                kind,
                text,
                no_newline,
            });
        }
        result
    }
}

/// One line of a rebuilt hunk.
struct PatchLine {
    /// ' ', '+' or '-'.
    kind: char,
    text: String,
    /// The line is the last of its side and has no newline.
    no_newline: bool,
}

impl PatchLine {
    fn render(&self) -> Vec<String> {
        let line = format!("{}{}", self.kind, self.text);
        if self.no_newline {
            vec![line, NO_NEWLINE.to_string()]
        } else {
            vec![line]
        }
    }

    fn in_old(&self) -> bool {
        self.kind != '+'
    }

    fn in_new(&self) -> bool {
        self.kind != '-'
    }
}

const NO_NEWLINE: &str = "\\ No newline at end of file";

/// A line without a newline must stay the last line of each side it appears on.
fn check_final_newlines(body: &[PatchLine]) -> AppResult<()> {
    for (position, line) in body.iter().enumerate() {
        if !line.no_newline {
            continue;
        }
        let rest = &body[position + 1..];
        let old_after = line.in_old() && rest.iter().any(PatchLine::in_old);
        let new_after = line.in_new() && rest.iter().any(PatchLine::in_new);
        if old_after || new_after {
            return Err(AppError::invalid(
                "The last line of this file has no newline at its end, so the lines around it can only be staged, unstaged or discarded together. Use the hunk button or the whole file instead.",
            ));
        }
    }
    Ok(())
}

fn offset(value: usize, by: isize) -> usize {
    value.saturating_add_signed(by)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(items: &[usize]) -> BTreeSet<usize> {
        items.iter().copied().collect()
    }

    #[test]
    fn selection_keeps_unselected_lines_as_context() {
        let text = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -10,2 +10,3 @@\n x\n+y\n z\n";
        let patch = FilePatch::new(text);
        assert_eq!(
            patch.hunks.iter().map(|h| h.header).collect::<Vec<_>>(),
            vec![3, 8]
        );
        assert_eq!(patch.changed_lines(), set(&[5, 6, 10]));
        assert_eq!(
            patch.patch(&set(&[6]), false).unwrap(),
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,4 @@\n a\n b\n+B\n c\n"
        );
        assert_eq!(
            patch.patch(&set(&[5, 10]), true).unwrap(),
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,4 +1,3 @@\n a\n-b\n B\n c\n@@ -11,2 +10,3 @@\n x\n+y\n z\n"
        );
        assert!(patch.patch(&set(&[4]), false).is_err());
        let created = FilePatch::new(
            "diff --git a/n b/n\nnew file mode 100644\n--- /dev/null\n+++ b/n\n@@ -0,0 +1,2 @@\n+1\n+2\n",
        );
        assert!(created.patch(&set(&[5]), false).is_err());
        assert!(created.patch(&set(&[5, 6]), false).is_ok());
    }

    #[test]
    fn hunk_headers_and_line_splitting() {
        assert_eq!(parse_hunk_header("@@ -10,3 +20,4 @@ fn x"), Some((10, 20)));
        assert_eq!(parse_hunk_header("@@ -1 +1 @@"), Some((1, 1)));
        assert_eq!(parse_hunk_header("@@ nope"), None);
        assert_eq!(split_lines("a\r\nb\n"), vec!["a\r", "b"]);
        assert_eq!(split_lines("a\nb"), vec!["a", "b"]);
        assert!(split_lines("").is_empty());
    }
}
