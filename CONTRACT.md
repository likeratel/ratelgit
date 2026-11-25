# ratelgit IPC contract

The Rust core (`src-tauri`) runs the local Git CLI, owns the project list and preferences file,
and shows the native folder picker. The web UI (`src`) owns layout, selection and every view.
They talk only through the commands below. All payloads are JSON with camelCase keys. There are
no events: the UI asks, the core answers.

Every command that takes `worktree` first checks, in the core, that the path is an available
worktree of a project in the sidebar (after one re-read of the projects' worktree lists). Any
other folder is refused with `not_found`, whatever the UI sends.

The UI parses every response with the zod schemas in `src/bridge/types.ts`.
`src/bridge/fixtures/core-samples.json` holds real responses recorded by
`src-tauri/tests/contract.rs`; that test fails when a response changes shape, and
`src/bridge/contract.test.ts` parses the same samples with the zod schemas. Requests the UI
sends are listed in `src/bridge/fixtures/requests.json`, and both sides must accept them. When a
payload changes, update this file, the Rust model, the zod schema and the samples together
(`UPDATE_CONTRACT_SAMPLES=1 cargo test --test contract`).

## Types

```ts
type Platform = "macos" | "windows" | "linux";

interface Worktree {
  path: string;              // absolute, as Git prints it (forward slashes on Windows too)
  name: string;              // last path component
  branch: string | null;     // null: detached HEAD
  isMain: boolean;           // first worktree Git lists
  unavailable: boolean;      // folder missing, prunable or bare
  changes: number | null;    // changed paths, each counted once
  ahead: number | null;      // null: no usable upstream
  behind: number | null;
}

interface Project {
  path: string;              // main worktree path, or the stored path if unresolved
  name: string;
  state: "ready" | "unavailable";
  reason: string | null;     // why it is unavailable
  worktrees: Worktree[];
}

interface Reference {
  id: string;                // "refs/heads/main", "refs/remotes/origin/x", "refs/tags/v1", "stash@{0}"
  name: string;              // "main", "origin/x", "v1", "stash@{0}"
  kind: "local" | "remote" | "tag" | "stash";
  target: string | null;     // commit, peeled for annotated tags
  isHead: boolean;           // checked out in the worktree the refs were read from
  worktreePath: string | null; // worktree that has this branch checked out
  subject: string | null;    // stash message
}

interface CommitLine {
  index: number;             // position in the whole listing, stable across pages
  hash: string; shortHash: string; subject: string; author: string;
  date: string;              // "YYYY-MM-DD", author date
  timestamp: number;         // author date, seconds since the epoch
  refs: string[];            // %D decorations: "HEAD -> main", "origin/main", "tag: v1"
  parents: string[];
}

interface HistoryPage { lines: CommitLine[]; complete: boolean; }

type ChangeKind = "staged" | "unstaged" | "untracked" | "committed";
type ConflictKind = "bothModified" | "bothAdded" | "bothDeleted" | "addedByUs"
  | "addedByThem" | "deletedByUs" | "deletedByThem";
interface ChangedFile {
  path: string;              // repository-relative, "/" separators
  kind: ChangeKind;
  status: string;            // "M" "A" "D" "T" "?" or "U" (conflicted)
  conflict: ConflictKind | null; // optional in requests
}

type Operation = "merge" | "rebase" | "cherryPick" | "revert";
interface OperationState {
  kind: Operation;
  ours: string | null;       // stage 2: current branch (merge), onto (rebase)
  theirs: string | null;     // stage 3: merged branch, or "abc1234 Subject" being replayed
  branch: string | null;     // branch being rebased
  step: number | null;       // rebase progress, 1-based
  total: number | null;
  conflicts: number;         // paths still unmerged
  message: string | null;    // prepared message (MERGE_MSG without comments)
}

interface Tracking { branch: string; remote: string; target: string; ahead: number; behind: number; }

interface WorktreeSnapshot {
  references: Reference[];
  filter: string[];          // filter used: requested minus refs that no longer exist,
                             // or the default filter when `filter` was null
  defaultFilter: string[];   // "HEAD" plus refs/remotes/origin/main and .../master that exist
  history: HistoryPage;      // first page (500 commits)
  headHidden: boolean;       // the filter hides the checked-out commit
  files: ChangedFile[];
  tracking: Tracking | null;
  operation: OperationState | null;
}

interface CommitInfo {
  detail: { hash: string; parents: string[]; author: string; email: string;
            date: string /* ISO 8601 */; message: string };
  files: ChangedFile[];      // kind "committed"; merges compare with the first parent
}

interface FileDiff {
  text: string;              // unified diff, a/ and b/ prefixes, no renames
  lossy: boolean;            // not UTF-8, decoded with replacements: line staging is off
  truncated: boolean;        // cut at 4 MiB: line staging is off
}

type Segment =
  | { type: "text"; lines: string[] }  // lines keep "\n" or "\r\n"
  | { type: "conflict"; oursLabel: string; baseLabel: string | null; theirsLabel: string;
      ours: string[]; base: string[] | null; theirs: string[] };
interface ConflictDocument {
  path: string;
  state: "ready" | "noMarkers" | "malformed" | "binary" | "notUtf8" | "tooLarge" | "missing";
  reason: string | null;
  fingerprint: string | null; // identifies the bytes read; saving checks it
  segments: Segment[];        // empty unless ready or noMarkers
}

interface RemovalPreview {
  path: string; branch: string | null; isMain: boolean;
  prunable: boolean;         // folder gone: removing only cleans up Git's record (`worktree prune`)
  locked: string | null;     // lock reason ("" when none given)
  operation: Operation | null;
  changes: number;           // changed tracked files that would be lost
  untracked: number;         // untracked files that would be lost
  unmergedCommits: number;   // commits on no other branch, remote branch or tag
  unmergedWithRemote: number; // the same, when the upstream remote branch is deleted too
  ignored: number;           // ignored files and folders deleted with it (a folder counts once)
  ignoredExamples: string[]; // up to three of their names
  submodules: boolean;       // contains submodules; Git removes it only with force
  upstream: { remote: string; name: string } | null;
  remoteBlock: string | null; // why the remote branch must stay: another name than the local
                             // branch, or the remote's default branch (HEAD, main, master)
  branchBlock: string | null; // why the local branch must stay (default branch, checked out elsewhere)
  tip: string | null;        // branch commit (or detached HEAD) when the preview was made
}
interface RemoveOptions {
  force: boolean; deleteBranch: boolean; allowUnmerged: boolean; deleteRemote: boolean;
  seen: {                    // what the dialog showed and the user agreed to lose
    changes: number; untracked: number; ignored: number;
    lostCommits: number;     // commits lost with the chosen deletions
    locked: boolean; operation: boolean; submodules: boolean; tip: string | null;
  };
}
interface RemovalResult { branchDeleted: boolean | null; remoteDeleted: boolean | null; problem: string | null; }

interface UiPreferences {
  diffLayout: "unified" | "split";
  ignoreWhitespace: boolean;
  sidebarWidth: number;      // 220..=420
  historySplit: number;      // share of History for the commit list, 0.2..=0.8
  changesSplit: number;      // share of Changes for the file list, 0.2..=0.8
  lastWorktree: string | null;
}

interface Preferences {
  version: 2;
  projects: string[];        // main worktree paths, display order
  filters: Record<string, string[]>; // project path -> full ref names or "HEAD";
                             // no entry: default filter; []: every branch
  ui: UiPreferences;
}

interface Bootstrap { preferences: Preferences; platform: Platform; }

interface AppError {         // rejected value of every command
  kind: "invalid_input" | "git_missing" | "git_too_old" | "not_found" | "git_failed" | "stale"
      | "not_fully_merged" | "conflict_markers" | "io"
      | "missing_objects"; // partial clone content not downloaded; reads never fetch
  message: string;           // shown to the user; Git's own text for git_failed
}
```

Preferences are stored as `ratelgit.json` in the app config folder. In version 1 an empty
filter list meant "nothing chosen"; it is read as the default filter. Each field is read on its
own: unknown fields are ignored and a field with a wrong type falls back to its default, so the
project list survives files from other versions. Out-of-range sizes are clamped, filters of
unknown projects and invalid refs are dropped, and only a file that is not JSON at all is
renamed to `ratelgit.json.corrupt` instead of being overwritten.

## Commands (UI → core)

| Command | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `get_bootstrap` | – | `Bootstrap` | Stored preferences, without running Git. |
| `list_projects` | – | `Project[]` | Resolves every stored project in parallel. Linked worktree paths collapse into their repository; the list is saved back. Missing folders come back `unavailable`. |
| `add_project` | – | `{ projects: Project[]; worktree: string \| null } \| null` | Shows the native folder picker in the core. `null` when cancelled. `worktree` is the worktree containing the chosen folder. |
| `remove_project` | `{ path }` | `string[]` | Stored project paths after removal. |
| `list_worktrees` | `{ worktree }` | `Worktree[]` | All worktrees of the project that owns `worktree`. |
| `load_worktree` | `{ worktree, filter: string[] \| null }` | `WorktreeSnapshot` | `filter`: `null` for the default filter (`HEAD` plus `origin/main`/`origin/master` that exist, worked out now), `[]` for every branch, remote and tag, or full ref names / `"HEAD"` (≤ 200). `"HEAD"` follows the worktree's checked-out commit. |
| `load_history` | `{ worktree, filter: string[] \| null, skip }` | `HistoryPage` | Next page of the same ordering. |
| `load_commit` | `{ worktree, hash }` | `CommitInfo` | `hash`: 40 or 64 lowercase hex. |
| `load_diff` | `{ worktree, file: ChangedFile, commit: string \| null, ignoreWhitespace }` | `FileDiff` | `commit` is required for `committed` files. |
| `load_conflict` | `{ worktree, path }` | `ConflictDocument` | Only for a file that is conflicted now (`stale` otherwise). Reads the work-tree file; never writes. Nested, unbalanced or ambiguous markers give `malformed`; a `|||||||` line counts as a base marker only when `merge.conflictStyle` is `diff3` or `zdiff3`. |
| `open_file` | `{ worktree, path }` | `{ action: "opened" \| "revealed" }` | Only for a file that is conflicted now, inside the worktree, not a link and not under `.git/`. Files that could run something when opened (script and program extensions, or the executable bit) are only revealed in the file manager. |
| `plan_worktree` | `{ worktree, parent: string \| null, folder, newBranch: string \| null }` | `{ path: string \| null; folderError: string \| null; branchError: string \| null }` | Checks names while they are typed; `addWorktree` checks again. |
| `worktree_removal` | `{ worktree, target }` | `RemovalPreview` | What removing `target` would delete. `target` must be in the `git worktree list` of the project that owns `worktree`. |
| `remove_worktree` | `{ worktree, target, options: RemoveOptions }` | `RemovalResult` | See below. |
| `choose_worktree_parent` | – | `{ token: string; path: string } \| null` | Native folder picker in the core for the folder that holds a new worktree. `null` when cancelled. `path` is for display; `addWorktree` takes the token. UNC and `\\?\` paths are refused. |
| `run_action` | `{ worktree, action: Action }` | `null` | See below. The UI reloads the worktree afterwards, also after a failure. |
| `save_preferences` | `{ filters, ui }` | `Preferences` | |

## Actions

`reference` is a full ref name. Every action re-checks the repository first: a file must still be
listed with the same kind and status, a stash index must still name the same commit, an
operation must still be the one in progress. Otherwise the action fails with `stale`.

```ts
type Action =
  | { type: "stage" | "unstage" | "discard"; file: ChangedFile }
  | { type: "applyLines"; file: ChangedFile; source: string; lines: number[];
      operation: "stage" | "unstage" | "discard" }   // `source` must equal the current diff
  | { type: "commit"; message: string }
  | { type: "createBranch"; name: string }
  | { type: "switchBranch" | "checkoutRemote" | "merge" | "rebase"; reference: string }
  | { type: "renameBranch"; reference: string; name: string }
  | { type: "deleteBranch"; reference: string; force: boolean } // not_fully_merged without force
  | { type: "addWorktree"; parent: string | null; folder: string;
      branch: { type: "new"; name: string; startPoint: string }   // full ref or "HEAD"; no tracking
            | { type: "existing"; reference: string }             // refs/heads/…, not checked out
            | { type: "remote"; reference: string } }             // refs/remotes/…, tracked
      // `parent`: token from choose_worktree_parent, or null for the folder containing the
      // project; `folder`: one plain folder name. The UI never sends a folder path.
  | { type: "stash"; message: string }
  | { type: "applyStash" | "dropStash"; stash: string /* "stash@{n}" */; revision: string }
  | { type: "abort"; operation: Operation }
  | { type: "continue"; operation: Operation; message: string | null }
  | { type: "resolveSide"; file: ChangedFile; side: "ours" | "theirs" }
  | { type: "keepFile" | "deleteFile"; file: ChangedFile }
  | { type: "markResolved"; file: ChangedFile; force: boolean } // conflict_markers without force
  | { type: "saveResolution"; file: ChangedFile; fingerprint: string;
      choices: ("ours" | "theirs" | "oursThenTheirs" | "theirsThenOurs")[] }
  | { type: "fetch" | "pull" | "push" };
```

- `discard`, `applyLines` with `discard`, `deleteBranch`, `dropStash`, `deleteFile`, `abort` and a
  forced `markResolved` cannot be undone; the UI confirms them first.
- `continue` requires that no path is unmerged. A merge is committed with `message` (or Git's
  prepared message when `null`). A rebase, cherry-pick or revert runs `--continue` with an editor
  that accepts the prepared message; stopping at the next conflict is not an error.
- `resolveSide` checks out stage 2 (`ours`) or 3 (`theirs`) and stages it; if that side deleted
  the file, the file is removed. In a rebase, `ours` is the branch being rebased onto and
  `theirs` the commit being replayed, so the UI labels sides with `OperationState` names and the
  marker labels rather than the words ours/theirs.
- `saveResolution` needs one choice per conflict chunk, re-reads the file and refuses with
  `stale` if its fingerprint changed, then writes the composed text (line endings, final newline
  and byte-order mark preserved) and stages it.
- Line actions refuse (`invalid_input`) a selection that has no correct patch: a line without
  a final newline that would stop being the last line. The whole hunk always works. Mode
  changes are left out of hunk and line patches.
- `merge` and `rebase` pass the full ref name, so a tag with the branch's name is never used.
- Commit and merge messages are committed as given (`--cleanup=whitespace`), so lines such as
  `#123 fix login` stay. Git's own comment lines (`# Conflicts:`, `#\tfile`) are taken out of
  the prepared merge message before it is offered.
- `remove_worktree` refuses the main worktree and paths outside the project's worktree list, and
  checks consent before touching anything: `force` for changes, untracked or ignored files,
  submodules, a stopped operation or a lock; `allowUnmerged` when commits would be on no ref
  afterwards (counting the remote branch as gone when `deleteRemote` is set, and a detached
  HEAD's own commits); no `deleteBranch` when `branchBlock` is set; `deleteRemote` only with
  `deleteBranch`, an upstream and no `remoteBlock`. A worktree whose folder is gone is cleaned
  up on its own (`git worktree remove`), leaving other missing worktrees alone.
- Right before removing, the core reads the preview again. If more would be lost than `seen`
  says (more files or commits, a new kind of loss, or a moved branch tip), it refuses with
  `stale` and the UI shows the dialog again with the new numbers. The flags alone never remove
  anything.
- The remote branch is deleted with `--force-with-lease` against the last fetched
  `<remote>/<name>`; if the remote moved since, it is kept and `problem` says so. It then runs
  `git worktree remove` (Git deletes the folder), `git branch -D`, and `git push --delete` (a
  network command), each only after the previous one worked. A later failure is not an error:
  the result's `problem` says which steps were done.
- `pull` is fast-forward only; `pull` and `push` use the branch's upstream and fail without one.
- Git runs with `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never` and no editor, so
  credential prompts fail instead of waiting. Settings that change parsed output or start
  programs are overridden on every command (`color.*`, `diff.noprefix`, `diff.mnemonicPrefix`,
  `diff.suppressBlankEmpty`, `core.fsmonitor`, `log.showSignature`; diffs also use `--no-color`,
  `--unified=3`, `--no-ext-diff`, `--no-textconv`, `--no-renames`). Reading commands also get
  `protocol.allow=never` and `GIT_NO_LAZY_FETCH=1`. Git runs in its own process group; on a
  timeout (2 minutes, 5 for network commands) the whole group is stopped, and output pipes held
  open by a hook's background process are given up after 2 seconds.
- Output is capped: 4 MiB per diff (`truncated`), 32 MiB for status, 64 MiB otherwise (beyond
  that the command fails). Untracked files above 4 MiB, and links, are described instead of
  read. Git older than 2.36 is refused with `git_too_old`.
- File paths from the UI are repository-relative with plain components only: no `..`, `.`, empty
  parts, backslashes, drive letters or leading colon (any colon on Windows). An untracked diff
  needs the file to be listed as untracked and to stay inside the worktree.
- A worktree is registered only if its top level is its own folder and it shares the project's
  common Git folder (`core.worktree` redirects and foreign `.git` files are refused).
