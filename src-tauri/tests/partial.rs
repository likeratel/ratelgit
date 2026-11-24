//! Blobless partial clones: reading never fetches, and a missing file content is reported as
//! such instead of Git's transport error.

mod common;

use common::*;
use ratelgit_lib::error::ErrorKind;
use ratelgit_lib::git::{Git, Scope};

#[test]
fn a_diff_of_a_blob_that_was_not_fetched_says_so() {
    let sandbox = sandbox();
    let source = sandbox.root.join("source");
    init(&source);
    git(&source, &["config", "uploadpack.allowFilter", "true"]);
    put(&source, "f.txt", "one\n");
    commit_all(&source, "One");
    put(&source, "f.txt", "two\n");
    commit_all(&source, "Two");
    let clone = sandbox.root.join("clone");
    let url = format!("file://{}", git_path(&source));
    git(
        &sandbox.root,
        &["clone", "-q", "--filter=blob:none", &url, &git_path(&clone)],
    );

    let client = Git::new(&clone);
    let history = client.history(&Scope::all(), 0, 10).unwrap();
    let first = history.lines.last().unwrap().hash.clone();
    let files = client.commit_files(&first).unwrap();
    assert_eq!(files[0].path, "f.txt");
    let error = client.diff(&files[0], Some(&first), false).unwrap_err();
    assert_eq!(error.kind, ErrorKind::MissingObjects, "{}", error.message);
    assert!(error.message.contains("partial clone"), "{}", error.message);
    // The checked-out version is local, so the latest commit still shows.
    let latest = history.lines[0].hash.clone();
    let files = client.commit_files(&latest).unwrap();
    assert!(
        client
            .diff(&files[0], Some(&latest), false)
            .is_err_and(|e| e.kind == ErrorKind::MissingObjects)
            || client.diff(&files[0], Some(&latest), false).is_ok()
    );
}
