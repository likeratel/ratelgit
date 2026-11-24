//! Ported from the SwiftUI version's ChangeTests: hunk and line staging, discard, whitespace.

mod common;

use std::collections::BTreeSet;
use std::path::PathBuf;

use common::*;
use ratelgit_lib::error::ErrorKind;
use ratelgit_lib::git::{Action, ChangeKind, ChangedFile, FilePatch, Git, LineOperation};

fn original() -> String {
    (1..=20).map(|n| format!("line {n}\n")).collect()
}

fn edited(changes: &[(usize, &str)], inserting: &[(usize, &[&str])]) -> String {
    (1..=20)
        .flat_map(|n| {
            let line = changes
                .iter()
                .find(|(at, _)| *at == n)
                .map_or(format!("line {n}"), |(_, text)| text.to_string());
            let extra = inserting
                .iter()
                .find(|(at, _)| *at == n)
                .map_or(Vec::new(), |(_, lines)| {
                    lines.iter().map(|l| l.to_string()).collect()
                });
            std::iter::once(line).chain(extra)
        })
        .map(|line| line + "\n")
        .collect()
}

fn repository() -> (Sandbox, PathBuf, Git) {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    init(&root);
    put(&root, "notes.txt", &original());
    commit_all(&root, "Base");
    let client = Git::new(&root);
    (sandbox, root, client)
}

fn diff(client: &Git, file: &ChangedFile) -> String {
    client.diff(file, None, false).unwrap().text
}

fn apply(client: &Git, file: ChangedFile, source: &str, lines: BTreeSet<usize>, op: LineOperation) {
    client
        .execute(&Action::ApplyLines {
            file,
            source: source.to_string(),
            lines: lines.into_iter().collect(),
            operation: op,
        })
        .unwrap();
}

#[test]
fn stage_and_unstage_hunks_and_lines() {
    let (_sandbox, root, client) = repository();
    let worktree_text = edited(&[(2, "line two")], &[(17, &["added a", "added b"])]);
    put(&root, "notes.txt", &worktree_text);
    let unstaged = file_of(&client, ChangeKind::Unstaged);
    let source = diff(&client, &unstaged);
    let patch = FilePatch::new(&source);
    assert_eq!(patch.hunks.len(), 2);

    let first: BTreeSet<usize> = patch
        .changed_lines_in(&patch.hunks[0])
        .into_iter()
        .collect();
    apply(&client, unstaged, &source, first, LineOperation::Stage);
    let staged = diff(&client, &file_of(&client, ChangeKind::Staged));
    assert!(staged.contains("+line two") && !staged.contains("added a"));
    let remaining = diff(&client, &file_of(&client, ChangeKind::Unstaged));
    assert!(!remaining.contains("+line two") && remaining.contains("+added a"));

    let second = FilePatch::new(&remaining);
    let only_b = second.lines.iter().position(|l| l == "+added b").unwrap();
    let unstaged = file_of(&client, ChangeKind::Unstaged);
    apply(
        &client,
        unstaged,
        &remaining,
        BTreeSet::from([only_b]),
        LineOperation::Stage,
    );
    let index = git(&root, &["show", ":notes.txt"]);
    assert!(index.contains("line 17\nadded b\nline 18"));
    assert!(!index.contains("added a"));
    assert_eq!(read(&root, "notes.txt"), worktree_text);

    let staged_file = file_of(&client, ChangeKind::Staged);
    let staged_source = diff(&client, &staged_file);
    let staged_patch = FilePatch::new(&staged_source);
    let pair: BTreeSet<usize> = (0..staged_patch.lines.len())
        .filter(|&i| ["-line 2", "+line two"].contains(&staged_patch.lines[i].as_str()))
        .collect();
    assert_eq!(pair.len(), 2);
    apply(
        &client,
        staged_file,
        &staged_source,
        pair,
        LineOperation::Unstage,
    );
    let after = git(&root, &["show", ":notes.txt"]);
    assert!(after.starts_with("line 1\nline 2\nline 3\n"));
    assert!(after.contains("added b"));
    assert_eq!(
        read(&root, "notes.txt"),
        worktree_text,
        "unstaging never touches the worktree"
    );
}

#[test]
fn discard_hunk_file_and_untracked() {
    let (_sandbox, root, client) = repository();
    put(
        &root,
        "notes.txt",
        &edited(&[(2, "line two"), (19, "line nineteen")], &[]),
    );
    let file = file_of(&client, ChangeKind::Unstaged);
    let source = diff(&client, &file);
    let patch = FilePatch::new(&source);
    let second: BTreeSet<usize> = patch
        .changed_lines_in(&patch.hunks[1])
        .into_iter()
        .collect();
    apply(&client, file, &source, second, LineOperation::Discard);
    assert_eq!(read(&root, "notes.txt"), edited(&[(2, "line two")], &[]));

    put(&root, "notes.txt", "changed again\n");
    let stale = client.execute(&Action::ApplyLines {
        file: file_of(&client, ChangeKind::Unstaged),
        source: source.clone(),
        lines: patch.changed_lines_in(&patch.hunks[0]),
        operation: LineOperation::Discard,
    });
    assert_eq!(
        stale.unwrap_err().kind,
        ErrorKind::Stale,
        "a stale diff is refused"
    );
    client
        .execute(&Action::Discard {
            file: file_of(&client, ChangeKind::Unstaged),
        })
        .unwrap();
    assert_eq!(read(&root, "notes.txt"), original());

    put(&root, "dir/new [file].txt", "scratch\n");
    let untracked = file_of(&client, ChangeKind::Untracked);
    client
        .execute(&Action::Discard {
            file: untracked.clone(),
        })
        .unwrap();
    assert!(!root.join("dir/new [file].txt").exists());
    let gone = client.execute(&Action::Discard { file: untracked });
    assert_eq!(gone.unwrap_err().kind, ErrorKind::Stale, "the file is gone");
    assert!(client.working_files().unwrap().is_empty());
}

#[test]
fn ignore_whitespace_diff() {
    let (_sandbox, root, client) = repository();
    put(
        &root,
        "notes.txt",
        &edited(&[(3, "    line 3"), (10, "line ten")], &[]),
    );
    let changed = file_of(&client, ChangeKind::Unstaged);
    let plain = client.diff(&changed, None, false).unwrap().text;
    let quiet = client.diff(&changed, None, true).unwrap().text;
    assert!(plain.contains("+    line 3"));
    assert!(!quiet.contains("+    line 3"));
    assert!(quiet.contains("+line ten"));
    assert_eq!(FilePatch::new(&plain).changed_lines().len(), 4);
    assert_eq!(FilePatch::new(&quiet).changed_lines().len(), 2);
}

#[test]
fn crlf_lines_stage_without_damage() {
    let (_sandbox, root, client) = repository();
    put(&root, "win.txt", "a\r\nb\r\nc\r\n");
    commit_all(&root, "Windows file");
    put(&root, "win.txt", "a\r\nB\r\nc\r\nd\r\n");
    let file = client
        .working_files()
        .unwrap()
        .into_iter()
        .find(|f| f.path == "win.txt")
        .unwrap();
    let source = diff(&client, &file);
    let patch = FilePatch::new(&source);
    let only_b: BTreeSet<usize> = (0..patch.lines.len())
        .filter(|&i| patch.lines[i].starts_with("-b") || patch.lines[i].starts_with("+B"))
        .collect();
    apply(&client, file, &source, only_b, LineOperation::Stage);
    assert_eq!(git(&root, &["show", ":win.txt"]), "a\r\nB\r\nc\r\n");
    assert_eq!(read(&root, "win.txt"), "a\r\nB\r\nc\r\nd\r\n");
}

#[test]
fn non_utf8_diffs_refuse_line_staging() {
    let (_sandbox, root, client) = repository();
    std::fs::write(root.join("latin.txt"), b"caf\xe9\n").unwrap();
    commit_all(&root, "Latin-1");
    std::fs::write(root.join("latin.txt"), b"caf\xe9!\n").unwrap();
    let file = client
        .working_files()
        .unwrap()
        .into_iter()
        .find(|f| f.path == "latin.txt")
        .unwrap();
    let shown = client.diff(&file, None, false).unwrap();
    assert!(shown.lossy);
    let lines = FilePatch::new(&shown.text)
        .changed_lines()
        .into_iter()
        .collect();
    let refused = client.execute(&Action::ApplyLines {
        file: file.clone(),
        source: shown.text,
        lines,
        operation: LineOperation::Stage,
    });
    assert_eq!(refused.unwrap_err().kind, ErrorKind::InvalidInput);
    client.execute(&Action::Stage { file }).unwrap();
    assert_eq!(file_of(&client, ChangeKind::Staged).path, "latin.txt");
}

// ---------------------------------------------------------------------------------------------
// Line staging next to "\ No newline at end of file". A selection either applies exactly what
// the model below predicts, or is refused with `invalid_input` when no correct patch exists
// (a line without a final newline would end up in the middle of the file). It never corrupts.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Op {
    Stage,
    Unstage,
    Discard,
}

/// What applying `selection` of `diff` to `base` must produce: lines with "lacks newline" flags.
fn model(
    diff: &str,
    base: &str,
    selection: &BTreeSet<usize>,
    reverse: bool,
) -> Vec<(String, bool)> {
    let lines: Vec<&str> = diff
        .strip_suffix('\n')
        .unwrap_or(diff)
        .split('\n')
        .collect();
    let base_lines: Vec<(String, bool)> = base
        .split_inclusive('\n')
        .map(|l| match l.strip_suffix('\n') {
            Some(body) => (body.to_string(), false),
            None => (l.to_string(), true),
        })
        .collect();
    let mut out = Vec::new();
    let mut position = 0;
    let mut i = 0;
    while i < lines.len() {
        let Some(rest) = lines[i].strip_prefix("@@ -") else {
            i += 1;
            continue;
        };
        let numbers: Vec<usize> = rest
            .split(|c: char| !c.is_ascii_digit())
            .filter(|s| !s.is_empty())
            .take(4)
            .map(|s| s.parse().unwrap())
            .collect();
        let (old_start, old_count, new_start, new_count) = match numbers[..] {
            [a, b, c, d]
                if rest.starts_with(&format!("{a},")) && rest.contains(&format!("+{c},")) =>
            {
                (a, b, c, d)
            }
            _ => {
                let parts: Vec<&str> = rest.split(' ').collect();
                let parse = |s: &str| -> (usize, usize) {
                    let mut it = s.trim_start_matches(['-', '+']).split(',');
                    let start = it.next().unwrap().parse().unwrap();
                    let count = it.next().map_or(1, |c| c.parse().unwrap());
                    (start, count)
                };
                let (a, b) = parse(parts[0]);
                let (c, d) = parse(parts[1]);
                (a, b, c, d)
            }
        };
        let (start, count) = if reverse {
            (new_start, new_count)
        } else {
            (old_start, old_count)
        };
        let first = if count > 0 { start - 1 } else { start };
        out.extend(base_lines[position..first].iter().cloned());
        position = first + count;
        i += 1;
        while i < lines.len() && !lines[i].starts_with("@@ ") {
            let line = lines[i];
            let noeol = lines.get(i + 1).is_some_and(|next| next.starts_with('\\'));
            let body = (line.get(1..).unwrap_or("").to_string(), noeol);
            let chosen = selection.contains(&i);
            let keep = match line.chars().next() {
                Some(' ') => true,
                Some('+') => {
                    if reverse {
                        !chosen
                    } else {
                        chosen
                    }
                }
                Some('-') => {
                    if reverse {
                        chosen
                    } else {
                        !chosen
                    }
                }
                _ => false,
            };
            if keep {
                out.push(body);
            }
            i += 1;
        }
    }
    out.extend(base_lines[position..].iter().cloned());
    out
}

fn render(lines: &[(String, bool)]) -> String {
    lines
        .iter()
        .map(|(text, noeol)| {
            if *noeol {
                text.clone()
            } else {
                format!("{text}\n")
            }
        })
        .collect()
}

/// A selection whose correct result would put a line without newline before another line.
fn impossible(lines: &[(String, bool)]) -> bool {
    lines.iter().rev().skip(1).any(|(_, noeol)| *noeol)
}

/// Runs one line-staging case and checks it against the model. Returns true when refused.
fn check_case(old: &str, new: &str, op: Op, pick: &dyn Fn(usize, &str) -> bool) -> bool {
    let sandbox = sandbox();
    let root = sandbox.root.join("repo");
    init(&root);
    std::fs::write(root.join("f"), old).unwrap();
    commit_all(&root, "Base");
    std::fs::write(root.join("f"), new).unwrap();
    if op == Op::Unstage {
        git(&root, &["add", "f"]);
    }
    let client = Git::new(&root);
    let kind = if op == Op::Unstage {
        ChangeKind::Staged
    } else {
        ChangeKind::Unstaged
    };
    let file = file_of(&client, kind);
    let source = diff(&client, &file);
    let parsed = FilePatch::new(&source);
    let selection: BTreeSet<usize> = parsed
        .changed_lines()
        .into_iter()
        .filter(|&i| pick(i, &parsed.lines[i]))
        .collect();
    assert!(!selection.is_empty(), "the case selects nothing:\n{source}");
    let reverse = op != Op::Stage;
    let base = if op == Op::Stage { old } else { new };
    let expected = model(&source, base, &selection, reverse);
    let operation = match op {
        Op::Stage => LineOperation::Stage,
        Op::Unstage => LineOperation::Unstage,
        Op::Discard => LineOperation::Discard,
    };
    let result = client.execute(&Action::ApplyLines {
        file,
        source: source.clone(),
        lines: selection.iter().copied().collect(),
        operation,
    });
    let context = format!("{op:?} {selection:?}\n{source}");
    match result {
        Err(error) => {
            assert_eq!(
                error.kind,
                ErrorKind::InvalidInput,
                "{}\n{context}",
                error.message
            );
            assert!(
                impossible(&expected),
                "refused a selection that has a correct result\n{context}"
            );
            assert_eq!(
                std::fs::read_to_string(root.join("f")).unwrap(),
                new,
                "worktree untouched"
            );
            true
        }
        Ok(()) => {
            assert!(
                !impossible(&expected),
                "applied a selection that cannot be correct\n{context}"
            );
            let got = if op == Op::Discard {
                std::fs::read_to_string(root.join("f")).unwrap()
            } else {
                git(&root, &["show", ":f"])
            };
            assert_eq!(got, render(&expected), "{context}");
            false
        }
    }
}

#[test]
fn no_newline_cases_from_review_never_corrupt() {
    let only = |text: &'static str| move |_: usize, line: &str| line == text;
    // A2: stage only "+c" while "b" loses its missing newline.
    assert!(check_case("a\nb", "a\nb\nc\n", Op::Stage, &only("+c")));
    // D2: discard only "-b".
    assert!(check_case("a\nb", "a\nb\nc\n", Op::Discard, &only("-b")));
    // E2: both sides lack a final newline; stage only "+B".
    assert!(check_case("a\nb", "a\nB", Op::Stage, &only("+B")));
    // F2: discard only "-b".
    assert!(check_case("a\nb", "a\nB", Op::Discard, &only("-b")));
    // H: old ends with a newline, new appends a line without one; stage only "+c".
    check_case("a\nb\n", "a\nb\nc", Op::Stage, &only("+c"));
    // I: the last line loses its newline; discard the "+b" side only.
    check_case("a\nb\n", "a\nb", Op::Discard, &only("+b"));
    // Selections that do have a correct result still apply.
    assert!(!check_case("a\nb", "a\nB", Op::Stage, &only("-b")));
    assert!(!check_case("a\nb", "a\nb\nc\n", Op::Stage, &|_, _| true));
    assert!(!check_case("a\nb", "a\nB", Op::Unstage, &|_, _| true));
}

/// xorshift64, so failures reproduce from the seed.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn chance(&mut self) -> bool {
        self.next().is_multiple_of(2)
    }
}

fn random_lines(rng: &mut Rng, count: usize) -> Vec<String> {
    let words = ["a", "b", "c", "}", "", "x1", "x2", "x3"];
    (0..count)
        .map(|_| words[rng.below(words.len())].to_string())
        .collect()
}

fn random_edit(rng: &mut Rng, lines: &[String]) -> Vec<String> {
    let mut out = lines.to_vec();
    for _ in 0..1 + rng.below(4) {
        let at = rng.below(out.len() + 1);
        match rng.below(3) {
            0 => {
                let count = 1 + rng.below(3);
                let added = random_lines(rng, count);
                out.splice(at..at, added);
            }
            1 if !out.is_empty() => {
                let end = (at + 1 + rng.below(3)).min(out.len());
                out.drain(at.min(out.len())..end);
            }
            _ if !out.is_empty() => {
                let index = at.min(out.len() - 1);
                out[index].push('!');
            }
            _ => {}
        }
    }
    out
}

fn join(lines: &[String], newline_at_end: bool) -> String {
    let mut text = lines.join("\n");
    if newline_at_end && !lines.is_empty() {
        text.push('\n');
    }
    text
}

#[test]
fn random_selections_match_the_model_with_and_without_final_newlines() {
    let mut rng = Rng(0x5eed_1234_abcd_0042);
    let mut applied = 0;
    let mut refused = 0;
    for _ in 0..120 {
        let count = 1 + rng.below(14);
        let old_lines = random_lines(&mut rng, count);
        let new_lines = random_edit(&mut rng, &old_lines);
        let old = join(&old_lines, rng.chance());
        let new = join(&new_lines, rng.chance());
        if old == new || new.is_empty() || old.is_empty() {
            continue;
        }
        let op = [Op::Stage, Op::Unstage, Op::Discard][rng.below(3)];
        let seed = rng.next();
        let pick = move |index: usize, _: &str| {
            (seed >> (index % 61)) & 1 == 1 || index % 61 == (seed % 7) as usize
        };
        if !has_selection(&old, &new, op, &pick) {
            continue;
        }
        if check_case(&old, &new, op, &pick) {
            refused += 1;
        } else {
            applied += 1;
        }
    }
    assert!(
        applied > 40,
        "too few applied cases: {applied} applied, {refused} refused"
    );
}

/// Whether `pick` selects at least one changed line of this case's diff.
fn has_selection(old: &str, new: &str, op: Op, pick: &dyn Fn(usize, &str) -> bool) -> bool {
    let sandbox = sandbox();
    let root = sandbox.root.join("probe");
    init(&root);
    std::fs::write(root.join("f"), old).unwrap();
    commit_all(&root, "Base");
    std::fs::write(root.join("f"), new).unwrap();
    let args: &[&str] = if op == Op::Unstage {
        git(&root, &["add", "f"]);
        &[
            "diff",
            "--cached",
            "--no-renames",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            "--",
            "f",
        ]
    } else {
        &[
            "diff",
            "--no-renames",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            "--",
            "f",
        ]
    };
    let text = git(&root, args);
    let parsed = FilePatch::new(&text);
    parsed
        .changed_lines()
        .into_iter()
        .any(|i| pick(i, &parsed.lines[i]))
}

/// A repository whose Git settings would change diff output if they were honoured.
fn hostile_config(root: &std::path::Path) {
    for (key, value) in [
        ("color.diff", "always"),
        ("color.ui", "always"),
        ("diff.context", "0"),
        ("diff.noprefix", "true"),
        ("diff.mnemonicPrefix", "true"),
        ("diff.renames", "copies"),
        ("diff.interHunkContext", "10"),
        ("diff.suppressBlankEmpty", "true"),
        ("core.autocrlf", "input"),
    ] {
        git(root, &["config", key, value]);
    }
}

#[test]
fn diff_parsing_and_line_staging_ignore_user_diff_settings() {
    let (_sandbox, root, client) = repository();
    hostile_config(&root);
    put(
        &root,
        "notes.txt",
        &edited(&[(2, "line two"), (19, "line nineteen")], &[]),
    );
    let file = file_of(&client, ChangeKind::Unstaged);
    let source = diff(&client, &file);
    assert!(!source.contains('\u{1b}'), "no colour codes:\n{source}");
    assert!(source.contains("--- a/notes.txt") && source.contains("+++ b/notes.txt"));
    let patch = FilePatch::new(&source);
    assert_eq!(patch.hunks.len(), 2, "three lines of context:\n{source}");
    assert!(source.contains(" line 1\n-line 2\n+line two\n line 3\n line 4\n line 5\n"));
    let first: BTreeSet<usize> = patch
        .changed_lines_in(&patch.hunks[0])
        .into_iter()
        .collect();
    apply(&client, file, &source, first, LineOperation::Stage);
    let index = git(&root, &["show", ":notes.txt"]);
    assert!(index.contains("line two") && !index.contains("line nineteen"));
}

#[cfg(unix)]
#[test]
fn line_staging_leaves_a_mode_change_unstaged() {
    use std::os::unix::fs::PermissionsExt;
    let (_sandbox, root, client) = repository();
    git(&root, &["config", "core.fileMode", "true"]);
    put(
        &root,
        "notes.txt",
        &edited(&[(2, "line two"), (19, "line nineteen")], &[]),
    );
    std::fs::set_permissions(
        root.join("notes.txt"),
        std::fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    let file = file_of(&client, ChangeKind::Unstaged);
    let source = diff(&client, &file);
    assert!(source.contains("new mode 100755"));
    let patch = FilePatch::new(&source);
    let first: BTreeSet<usize> = patch
        .changed_lines_in(&patch.hunks[0])
        .into_iter()
        .collect();
    apply(&client, file, &source, first, LineOperation::Stage);
    let mode = git(&root, &["ls-files", "-s", "notes.txt"]);
    assert!(mode.starts_with("100644"), "mode stays unstaged: {mode}");
    assert!(git(&root, &["show", ":notes.txt"]).contains("line two"));
    let rest = diff(&client, &file_of(&client, ChangeKind::Unstaged));
    assert!(rest.contains("new mode 100755") && rest.contains("+line nineteen"));
}

#[test]
fn commit_messages_keep_lines_that_start_with_a_hash() {
    let (_sandbox, root, client) = repository();
    put(&root, "notes.txt", "changed\n");
    git(&root, &["add", "notes.txt"]);
    client
        .execute(&Action::Commit {
            message: "#123 fix login".into(),
        })
        .unwrap();
    assert_eq!(last_subject(&root), "#123 fix login");
    put(&root, "notes.txt", "changed again\n");
    git(&root, &["add", "notes.txt"]);
    client
        .execute(&Action::Commit {
            message: "Fix the redirect\n\n#456 was the report\nMore text\n".into(),
        })
        .unwrap();
    assert_eq!(
        git(&root, &["log", "-1", "--format=%B"]).trim_end(),
        "Fix the redirect\n\n#456 was the report\nMore text"
    );
}
