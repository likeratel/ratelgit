//! Temporary repositories for the integration tests. Fixture commands call Git directly;
//! the code under test goes through `ratelgit_lib`.
#![allow(dead_code)]

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

use ratelgit_lib::git::{ChangeKind, ChangedFile, Git, Reference};

static CLOCK: AtomicU64 = AtomicU64::new(0);
const START: u64 = 1_772_000_000;

/// A fresh temporary folder with its real path (macOS `/var` is a symlink to `/private/var`).
pub struct Sandbox {
    _dir: tempfile::TempDir,
    pub root: PathBuf,
}

pub fn sandbox() -> Sandbox {
    let dir = tempfile::tempdir().expect("temp dir");
    let root = dunce::canonicalize(dir.path()).expect("canonical temp dir");
    Sandbox { _dir: dir, root }
}

/// Git as Git itself prints paths: forward slashes on every platform.
pub fn git_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn next_date() -> String {
    let tick = CLOCK.fetch_add(1, Ordering::SeqCst) + 1;
    format!("@{} +0000", START + tick * 5_400)
}

/// Runs fixture Git in `directory` and returns stdout; panics on failure.
pub fn git(directory: &Path, args: &[&str]) -> String {
    try_git(directory, args, None).unwrap_or_else(|error| panic!("git {args:?}: {error}"))
}

pub fn try_git(directory: &Path, args: &[&str], input: Option<&str>) -> Result<String, String> {
    let date = next_date();
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(directory)
        .args(["-c", "user.name=RatelGit Test", "-c"])
        .args([
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(["-c", "tag.gpgsign=false", "-c", "init.defaultBranch=main"])
        .args(["-c", "core.autocrlf=false"])
        .args(args)
        .env("GIT_AUTHOR_DATE", &date)
        .env("GIT_COMMITTER_DATE", &date)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    if let (Some(text), Some(mut stdin)) = (input, child.stdin.take()) {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!(
            "{stdout}{}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// Sets an identity in the repository config so the app's own `git commit` works.
pub fn configure_identity(directory: &Path) {
    git(directory, &["config", "user.name", "RatelGit Test"]);
    git(directory, &["config", "user.email", "test@example.invalid"]);
    git(directory, &["config", "commit.gpgsign", "false"]);
    git(directory, &["config", "core.autocrlf", "false"]);
}

pub fn put(directory: &Path, file: &str, text: &str) {
    let path = directory.join(file);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

pub fn read(directory: &Path, file: &str) -> String {
    fs::read_to_string(directory.join(file)).unwrap()
}

pub fn commit_all(directory: &Path, message: &str) {
    git(directory, &["add", "-A"]);
    git(directory, &["commit", "-q", "-m", message]);
}

pub fn init(directory: &Path) {
    fs::create_dir_all(directory).unwrap();
    git(directory, &["init", "-q", "-b", "main"]);
    configure_identity(directory);
}

/// main with a merged side branch, `feature/x/y` and `fix/login` branches, a tag, and an
/// `origin` remote whose branches lag behind.
pub fn sample_repository(root: &Path, name: &str) -> PathBuf {
    let remote = root.join(format!("{name}-remote.git"));
    let repo = root.join(name);
    git(
        root,
        &["init", "-q", "--bare", "-b", "main", &git_path(&remote)],
    );
    init(&repo);
    git(&repo, &["remote", "add", "origin", &git_path(&remote)]);
    put(&repo, "README.md", "# Sample\n");
    commit_all(&repo, "Initial commit");
    put(&repo, "src/app.ts", "let value = 1\n");
    commit_all(&repo, "Add app entry point");
    git(&repo, &["push", "-q", "-u", "origin", "main"]);
    git(&repo, &["switch", "-q", "-c", "side"]);
    put(&repo, "side.txt", "side\n");
    commit_all(&repo, "Add side notes");
    git(&repo, &["switch", "-q", "main"]);
    put(&repo, "src/app.ts", "let value = 2\n");
    commit_all(&repo, "Bump the value");
    git(&repo, &["merge", "-q", "--no-ff", "--no-edit", "side"]);
    git(&repo, &["tag", "-a", "v1.0", "-m", "Version 1.0"]);
    git(&repo, &["switch", "-q", "-c", "feature/x/y"]);
    put(&repo, "nested.txt", "nested\n");
    commit_all(&repo, "Start nested feature");
    git(&repo, &["push", "-q", "origin", "feature/x/y"]);
    put(&repo, "nested.txt", "nested more\n");
    commit_all(&repo, "Extend nested feature");
    git(&repo, &["switch", "-q", "-c", "fix/login", "main"]);
    put(&repo, "login.txt", "login fix\n");
    commit_all(&repo, "Fix login redirect");
    git(&repo, &["switch", "-q", "main"]);
    git(&repo, &["fetch", "-q", "origin"]);
    repo
}

/// A linear `main` with `count` empty commits, written in one `fast-import`.
pub fn long_history(directory: &Path, count: usize) {
    init(directory);
    let stream: String = (1..=count)
        .map(|index| {
            let parent = if index > 1 {
                format!("from :{}\n", index - 1)
            } else {
                String::new()
            };
            let message = format!("Commit {index}");
            format!(
                "commit refs/heads/main\nmark :{index}\ncommitter Test <test@example.invalid> {} +0000\ndata {}\n{message}\n{parent}\n",
                1_700_000_000 + index,
                message.len()
            )
        })
        .collect();
    try_git(directory, &["fast-import", "--quiet"], Some(&stream)).unwrap();
    git(directory, &["reset", "-q", "--hard", "main"]);
}

pub fn reference(client: &Git, id: &str) -> Reference {
    client
        .references()
        .unwrap()
        .into_iter()
        .find(|r| r.id == id)
        .unwrap_or_else(|| panic!("missing ref {id}"))
}

pub fn has_ref(client: &Git, id: &str) -> bool {
    client.references().unwrap().iter().any(|r| r.id == id)
}

pub fn file_of(client: &Git, kind: ChangeKind) -> ChangedFile {
    client
        .working_files()
        .unwrap()
        .into_iter()
        .find(|f| f.kind == kind)
        .unwrap_or_else(|| panic!("no {kind:?} file"))
}

pub fn last_subject(directory: &Path) -> String {
    git(directory, &["log", "-1", "--format=%s"])
        .trim()
        .to_string()
}

/// Removes a worktree agreeing to exactly what its preview shows right now, as the dialog does.
pub fn remove_agreed(
    client: &Git,
    target: &str,
    options: &ratelgit_lib::git::RemoveOptions,
) -> ratelgit_lib::error::AppResult<ratelgit_lib::git::RemovalResult> {
    let preview = client.removal_preview(target)?;
    let agreed = ratelgit_lib::git::RemoveOptions {
        seen: ratelgit_lib::git::Seen::of(&preview, options),
        ..options.clone()
    };
    client.remove_worktree(target, &agreed)
}
