//! Child process plumbing for the runner: capped output readers, a deadline, and killing the
//! whole process group (hooks and helpers included) when Git must stop.

use std::io::Read;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::error::{AppError, AppResult};

const POLL_INTERVAL: Duration = Duration::from_millis(10);
/// After Git exits, how long to wait for its output pipes to close. A hook that leaves a
/// background process holding the pipe must not keep the app waiting.
pub const READER_GRACE: Duration = Duration::from_secs(2);
const CHUNK: usize = 64 * 1024;

/// Output gathered by a reader thread, shared so it can be taken after the grace period.
#[derive(Clone, Default)]
pub struct Captured {
    data: Arc<Mutex<Vec<u8>>>,
    done: Arc<AtomicBool>,
}

impl Captured {
    pub fn take(&self) -> Vec<u8> {
        std::mem::take(&mut *self.data.lock().unwrap_or_else(|p| p.into_inner()))
    }

    pub fn finished(&self) -> bool {
        self.done.load(Ordering::SeqCst)
    }
}

/// Reads `source` until it closes, keeping at most `limit` bytes. With `overflow`, more output
/// sets the flag and stops reading so the caller can stop the process; without it, the extra
/// output is read and dropped, so the writer never sees a closed pipe.
pub fn spawn_reader<R: Read + Send + 'static>(
    source: Option<R>,
    limit: usize,
    overflow: Option<Arc<AtomicBool>>,
) -> Captured {
    let captured = Captured::default();
    let shared = captured.clone();
    thread::spawn(move || {
        if let Some(mut reader) = source {
            let mut chunk = vec![0; CHUNK];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(read) => {
                        let mut data = shared.data.lock().unwrap_or_else(|p| p.into_inner());
                        let room = limit.saturating_sub(data.len());
                        data.extend_from_slice(&chunk[..read.min(room)]);
                        if read > room {
                            if let Some(flag) = &overflow {
                                flag.store(true, Ordering::SeqCst);
                                break;
                            }
                        }
                    }
                    Err(error) => {
                        log::warn!("reading git output failed: {error}");
                        break;
                    }
                }
            }
        }
        shared.done.store(true, Ordering::SeqCst);
    });
    captured
}

/// Waits for the readers to see end of file, but no longer than the grace period.
pub fn settle(readers: &[&Captured]) {
    let started = Instant::now();
    while readers.iter().any(|r| !r.finished()) && started.elapsed() < READER_GRACE {
        thread::sleep(POLL_INTERVAL);
    }
}

pub enum Ending {
    Exited(Option<i32>),
    /// Stopped because the output passed its limit.
    Overflowed,
}

/// Waits for the child; kills its process group on timeout or when `overflow` is set.
pub fn wait(child: &mut Child, timeout: Duration, overflow: &AtomicBool) -> AppResult<Ending> {
    let started = Instant::now();
    loop {
        if overflow.load(Ordering::SeqCst) {
            kill_group(child);
            return Ok(Ending::Overflowed);
        }
        match child.try_wait() {
            Ok(Some(status)) => return Ok(Ending::Exited(status.code())),
            Ok(None) if started.elapsed() >= timeout => {
                kill_group(child);
                return Err(AppError::git(format!(
                    "Git did not finish within {} seconds and was stopped.",
                    timeout.as_secs()
                )));
            }
            Ok(None) => thread::sleep(POLL_INTERVAL),
            Err(error) => {
                log::error!("waiting for git failed: {error}");
                kill_group(child);
                return Err(AppError::git("Git stopped unexpectedly."));
            }
        }
    }
}

/// Starts Git in its own process group, so stopping it also stops hooks and helpers.
#[cfg(unix)]
pub fn isolate(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
pub fn isolate(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
}

#[cfg(not(any(unix, windows)))]
pub fn isolate(_command: &mut Command) {}

#[cfg(unix)]
fn kill_group(child: &mut Child) {
    if let Ok(pid) = i32::try_from(child.id()) {
        // SAFETY: kill(2) with a negative pid signals the process group we created; it has no
        // memory-safety preconditions.
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(windows)]
fn kill_group(child: &mut Child) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    let taskkill = std::path::Path::new(&root)
        .join("System32")
        .join("taskkill.exe");
    let status = Command::new(taskkill)
        .args(["/T", "/F", "/PID", &child.id().to_string()])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    if let Err(error) = status {
        log::warn!("taskkill failed: {error}");
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(not(any(unix, windows)))]
fn kill_group(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}
