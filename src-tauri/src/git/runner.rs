//! Runs Git with a fixed argument list. Never builds a shell string.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use super::locate::git_executable;
use super::process;
use crate::error::{AppError, AppResult};

/// Variables that would point Git at another repository than the one we pass with `-C`.
const SCRUBBED_ENVIRONMENT: &[&str] = &[
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_PREFIX",
    "GIT_OBJECT_DIRECTORY",
];
/// Non-interactive, locale-independent output; credential prompts fail instead of waiting.
const FIXED_ENVIRONMENT: &[(&str, &str)] = &[
    ("LC_ALL", "C"),
    ("LANG", "C"),
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GIT_EDITOR", "false"),
    ("GIT_SEQUENCE_EDITOR", "false"),
    ("GIT_MERGE_AUTOEDIT", "no"),
    ("GCM_INTERACTIVE", "never"),
    ("GIT_PAGER", "cat"),
];
/// Settings that would change output the app parses, or run programs the app never needs.
const FIXED_SETTINGS: &[&str] = &[
    "color.ui=false",
    "color.diff=false",
    "core.fsmonitor=false",
    "core.quotepath=false",
    "diff.suppressBlankEmpty=false",
    "diff.noprefix=false",
    "diff.mnemonicPrefix=false",
    "log.showSignature=false",
];
/// For reading commands only: no transport at all, so a repository's configuration cannot
/// start a fetch (for example a partial clone fetching a missing object with its own
/// `uploadpack` command). Fetch, pull and push are writing commands and keep their transports.
const READ_ONLY_SETTINGS: &[&str] = &["protocol.allow=never"];
const FALLBACK_MESSAGE_LIMIT: usize = 600;
/// Local commands should finish quickly; this only stops a hung process from holding a worker.
pub const LOCAL_TIMEOUT: Duration = Duration::from_secs(120);
/// Fetch, pull and push talk to a remote.
pub const NETWORK_TIMEOUT: Duration = Duration::from_secs(300);

/// Output kept from one command unless the command sets its own limit.
pub const DEFAULT_OUTPUT_LIMIT: usize = 64 * 1024 * 1024;

/// How one Git invocation should behave.
#[derive(Clone, Copy, Debug)]
pub struct RunOptions<'a> {
    /// Exit codes treated as success.
    pub accepted: &'a [i32],
    /// Writing commands take Git's optional locks; reading ones skip them.
    pub writing: bool,
    /// Treat pathspecs as literal paths so `[file].txt` or `*` mean exactly that.
    pub literal_paths: bool,
    pub input: Option<&'a [u8]>,
    pub timeout: Duration,
    /// Lets Git "open an editor" that accepts the prepared message unchanged
    /// (`rebase --continue`); otherwise any editor request fails.
    pub accept_editor: bool,
    /// Most bytes of stdout kept; Git is stopped when it writes more.
    pub output_limit: usize,
    /// Output cut at the limit is returned (as truncated) instead of failing.
    pub allow_truncation: bool,
}

impl Default for RunOptions<'_> {
    fn default() -> Self {
        Self {
            accepted: &[0],
            writing: false,
            literal_paths: false,
            input: None,
            timeout: LOCAL_TIMEOUT,
            accept_editor: false,
            output_limit: DEFAULT_OUTPUT_LIMIT,
            allow_truncation: false,
        }
    }
}

impl<'a> RunOptions<'a> {
    pub fn writing() -> Self {
        Self {
            writing: true,
            ..Self::default()
        }
    }

    pub fn accepting(accepted: &'a [i32]) -> Self {
        Self {
            accepted,
            ..Self::default()
        }
    }

    pub fn literal(self) -> Self {
        Self {
            literal_paths: true,
            ..self
        }
    }

    /// Keep at most `limit` bytes and return them marked as truncated.
    pub fn capped(self, limit: usize) -> Self {
        Self {
            output_limit: limit,
            allow_truncation: true,
            ..self
        }
    }
}

/// Raw result of a finished process.
pub struct Output {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub status: Option<i32>,
    /// Stdout passed the limit and Git was stopped.
    pub truncated: bool,
}

const STDERR_LIMIT: usize = 1024 * 1024;
/// Characters of Git's error text shown to the user; the end holds the reason.
const STDERR_MESSAGE_LIMIT: usize = 4000;

fn last_chars(text: &str, limit: usize) -> String {
    let skip = text.chars().count().saturating_sub(limit);
    text.chars().skip(skip).collect()
}

/// A Git client bound to one worktree folder.
#[derive(Clone, Debug)]
pub struct Git {
    path: PathBuf,
}

impl Git {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Runs Git and returns stdout decoded as UTF-8, with invalid bytes replaced.
    pub fn run(&self, args: &[&str], options: RunOptions) -> AppResult<String> {
        let bytes = self.run_bytes(args, options)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// Runs Git and returns raw stdout. Fails unless the exit code is accepted.
    pub fn run_bytes(&self, args: &[&str], options: RunOptions) -> AppResult<Vec<u8>> {
        self.run_capped(args, options).map(|(bytes, _)| bytes)
    }

    /// Runs Git; returns stdout and whether it was cut at `options.output_limit`.
    pub fn run_capped(&self, args: &[&str], options: RunOptions) -> AppResult<(Vec<u8>, bool)> {
        let output = self.spawn_and_wait(args, &options)?;
        if output.truncated {
            if options.allow_truncation {
                return Ok((output.stdout, true));
            }
            return Err(AppError::git(format!(
                "Git produced more than {} MB of output, more than ratelgit reads.",
                options.output_limit / (1024 * 1024)
            )));
        }
        let no_index_failure = args.contains(&"--no-index")
            && output.status != Some(0)
            && output.stdout.is_empty()
            && !output.stderr.is_empty();
        let accepted = output
            .status
            .is_some_and(|code| options.accepted.contains(&code));
        if !accepted || no_index_failure {
            return Err(AppError::git(failure_message(&output)));
        }
        Ok((output.stdout, false))
    }

    fn spawn_and_wait(&self, args: &[&str], options: &RunOptions) -> AppResult<Output> {
        let mut command = self.command(args, options)?;
        let mut child = command.spawn().map_err(|error| {
            log::error!("could not start git: {error}");
            AppError::git(format!("Git could not be started: {error}."))
        })?;
        let writer = feed_input(&mut child, options.input);
        let overflow = Arc::new(AtomicBool::new(false));
        let stdout = process::spawn_reader(
            child.stdout.take(),
            options.output_limit,
            Some(overflow.clone()),
        );
        // Extra error text is read and dropped, so a noisy hook never hits a closed pipe.
        let stderr = process::spawn_reader(child.stderr.take(), STDERR_LIMIT, None);
        let ending = process::wait(&mut child, options.timeout, &overflow);
        if let Some(writer) = writer {
            // A process that exits early closes its stdin; the resulting EPIPE is not our error.
            let _ = writer.join();
        }
        process::settle(&[&stdout, &stderr]);
        // The process may exit before the reader notices the output passed the limit.
        let (status, truncated) = match ending? {
            process::Ending::Exited(code) => (code, overflow.load(Ordering::SeqCst)),
            process::Ending::Overflowed => (None, true),
        };
        Ok(Output {
            stdout: stdout.take(),
            stderr: String::from_utf8_lossy(&stderr.take()).trim().to_string(),
            status,
            truncated,
        })
    }

    fn command(&self, args: &[&str], options: &RunOptions) -> AppResult<Command> {
        let mut command = Command::new(git_executable()?);
        if !options.writing {
            command.arg("--no-optional-locks");
        }
        if options.literal_paths {
            command.arg("--literal-pathspecs");
        }
        command.arg("--no-pager");
        for setting in FIXED_SETTINGS {
            command.args(["-c", setting]);
        }
        if !options.writing {
            for setting in READ_ONLY_SETTINGS {
                command.args(["-c", setting]);
            }
        }
        command.arg("-C").arg(&self.path).args(args);
        for name in SCRUBBED_ENVIRONMENT {
            command.env_remove(name);
        }
        command.envs(FIXED_ENVIRONMENT.iter().copied());
        if !options.writing {
            // A missing object in a partial clone must not trigger a fetch while reading.
            command.env("GIT_NO_LAZY_FETCH", "1");
        }
        if options.accept_editor {
            command.env("GIT_EDITOR", "true");
        }
        command
            .stdin(if options.input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        process::isolate(&mut command);
        Ok(command)
    }
}

fn feed_input(child: &mut Child, input: Option<&[u8]>) -> Option<thread::JoinHandle<()>> {
    let data = input?.to_vec();
    let mut stdin = child.stdin.take()?;
    Some(thread::spawn(move || {
        if let Err(error) = stdin.write_all(&data) {
            log::warn!("git stdin closed early: {error}");
        }
    }))
}

/// Merge reports conflicts on stdout, so fall back to it when stderr is empty.
fn failure_message(output: &Output) -> String {
    if !output.stderr.is_empty() {
        return last_chars(&output.stderr, STDERR_MESSAGE_LIMIT);
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if !trimmed.is_empty() {
        let skip = trimmed
            .chars()
            .count()
            .saturating_sub(FALLBACK_MESSAGE_LIMIT);
        return trimmed.chars().skip(skip).collect();
    }
    match output.status {
        Some(code) => format!("Git failed with status {code}."),
        None => "Git was stopped by a signal.".to_string(),
    }
}
