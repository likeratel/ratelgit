# ratelgit

English · [한국어](README.ko.md)

<img src="docs/ratelgit.png" alt="The ratelgit icon: a commit graph over a honey badger's two-tone coat" width="128" />

ratelgit is a macOS Git client built around worktrees. Add your repositories to the sidebar, pick any of their worktrees, and the commit graph, changed files and diffs follow, so you can move between projects and their checkouts without losing your place. It is named after the ratel, the honey badger that does not back off from a few stings. Built with Swift and SwiftUI on top of the Git command line you already have.

> Built with AI. I set the direction; the code, tests and docs were written in sessions with [Codex](https://openai.com/codex/) and [Claude Code](https://claude.com/claude-code). See [Why I built this](#why-i-built-this).

![Working changes of the selected worktree, with hunk buttons and word-level highlights in the diff](docs/screenshots/changes.png)

The screenshots are rendered from a sample repository with made-up commits.

## Contents

- [Why I built this](#why-i-built-this)
- [Install](#install)
- [Quick start](#quick-start)
- [Features](#features)
- [Shortcuts](#shortcuts)
- [Limits](#limits)
- [Development](#development)
- [License](#license)

## Why I built this

I keep several worktrees of the same repository open at once, and what I want from a Git client is simple: choose a worktree, then see its graph and its diff. Sourcetree, Fork and GitKraken cover the everyday Git features well, but switching between worktrees is not what they are built around. ratelgit borrows their basics (branches, a commit graph, staging, a diff viewer, fetch, pull and push) and puts the worktree list first.

What I did: decided the scope, starting from a read-only browser and then adding staging, commits and remote actions, and chose the safety rules (pull is fast-forward only, push is a plain push to the configured upstream). The implementation, tests and docs were written with Codex and Claude Code, and each stage went through an independent review round.

## Install

There is no packaged release yet, so build it from source. You need macOS 14 or later and Xcode 15 or later. If Xcode is not the selected developer directory, set `DEVELOPER_DIR` to its `Contents/Developer` path.

```sh
git clone https://github.com/likeratel/ratelgit.git
cd ratelgit
./scripts/run-app.sh
```

The script builds `.build/RatelGit.app` and opens it. To launch it from Spotlight, copy the bundle into your Applications folder:

```sh
./scripts/run-app.sh --build-only
cp -R .build/RatelGit.app ~/Applications/
```

## Quick start

1. Press `⌘O` and choose a repository or any of its linked worktrees. It is added under **Projects** and stays there after a relaunch. Add as many repositories as you like.
2. Pick a worktree under its project, step through a project's worktrees with `⌥⌘[` and `⌥⌘]`, or press `⌘P` and type part of a project, worktree or branch name. Each worktree row shows its branch, changed files and how far it is ahead of or behind its upstream.
3. **History** (`⌘1`) is the default view. Select a commit to read its message, files and diff on the right.
4. Switch to **Changes** (`⌘2`) to stage files, hunks or lines, write a message and press **Commit**.

## Features

### Projects and worktrees

- The sidebar lists every repository you added, each with its worktrees. The list is kept across relaunches; a project whose folder disappeared is shown as unavailable instead of failing. Remove a project from its context menu.
- Switching a worktree reloads the graph, branches, changed files and upstream status for that checkout, and only the last worktree you picked reaches the screen.
- A commit message draft stays with its worktree while the app is open.
- `⌘P` opens a quick switcher: fuzzy-match projects, worktrees and the branches of the current project with the keyboard (`↑` `↓`, `Return`, `Esc`). Picking a branch filters History to it.

### History

- By default the graph shows every local branch, remote branch and tag together with HEAD. Lanes and merge lines are drawn in colour; the mainline keeps its colour and merged branches curve into it.
- Columns: graph, ref badges and message, author, date and short hash. Author and date hide when the list gets narrow.
- An **Uncommitted changes (n)** row sits on top when the worktree has changes; clicking it opens Changes.
- History loads 500 commits at a time and fetches the next page when you scroll to the end. Lanes whose parents are on the next page keep running down.
- Filter like Fork: hover a branch, remote folder or folder in the sidebar and click its funnel to show only commits reachable from it. Several filters combine as a union. A bar above the list names the active filters and clears them; it also tells you when the worktree's HEAD is outside the filter. `⌘⇧A` toggles "current branch only". Filters are kept per project while the app is open.
- Search by message, author, date, hash or ref name within the loaded commits.
- Clicking a branch, tag or stash in the sidebar shows the commit it points at.

![Commit graph of several branches, and the message, files and diff of the selected commit](docs/screenshots/history.png)

### Changes

- Files are grouped into conflicts, unstaged, untracked and staged. Stage, unstage or discard a whole file from its row or from the diff header.
- In the diff, stage, unstage or discard a single hunk with the buttons on its header, or tick individual lines and act on just those.
- With the file list focused, `↑` `↓` move between files and `Space` stages or unstages the selected one. Typing in the commit message is not intercepted.
- Discarding always asks first. Discarding an untracked file deletes it, and the dialog says so.
- Commit is disabled until something is staged, a message is written and no conflicted file is left.

### Diff

- Unified and split layouts, both with line numbers.
- Changed line pairs highlight only the words that differ.
- **Ignore Whitespace** hides whitespace-only changes (`git diff -w`). Hunk and line staging is off while it is on, because such a diff cannot be applied back.
- The split layout measures the longest line, so long lines and wide characters such as Hangul stay in their own column.

### Branches, stashes and remotes

- Local branches and remote branches are shown as folder trees split on `/`; each remote is a top-level folder. The branch checked out in the current worktree is highlighted, and a branch checked out in another worktree carries an icon whose tooltip names that worktree.
- Local branch menu: Check Out, Merge into Current Branch, Rebase Current Branch onto This, Check Out in New Worktree…, Rename…, Delete…, and filters. Deleting asks first, and a branch that is not fully merged needs a second, separate confirmation to force it.
- Remote branch menu: check it out as a local tracking branch, or filter. Tags can be filtered.
- Stash menu: Apply (by commit ID, so a shifted stash index cannot apply the wrong one) and Drop… with confirmation.
- If a merge or rebase stops on conflicts, the error is shown, the conflicted files appear in Changes, and a banner offers **Abort**. Continue a rebase with `git rebase --continue` in Terminal; finish a merge by committing in Changes.
- Create a branch from HEAD or stash changes from **More**. Fetch, Pull and Push sit in the top bar.

## Shortcuts

| Shortcut | Action                                   |
| -------- | ---------------------------------------- |
| `⌘O`     | Add a repository                         |
| `⌘P`     | Quick switch to a project, worktree or branch |
| `⌘R`     | Refresh                                  |
| `⌘1`     | History                                  |
| `⌘2`     | Changes                                  |
| `⌘⇧A`    | Toggle "current branch only" in History  |
| `⌥⌘[`    | Previous worktree of the project         |
| `⌥⌘]`    | Next worktree of the project             |
| `Space`  | Stage or unstage the selected file (file list focused) |

## Limits

- Search only looks through the commits loaded so far.
- The files of a merge commit are compared with its first parent.
- History filters are kept only while the app is open.
- Hunk and line staging works on tracked text files. Untracked, new-file and conflicted changes are staged as whole files.
- There is no undo, cherry-pick, revert, reset, interactive rebase, drag-and-drop, remote management or submodule support. Use the command line for those.
- Pull is fast-forward only. Pull and Push need a remote upstream on the current branch.
- Remote authentication uses your existing Git credential setup; ratelgit does not store credentials.

## Development

```sh
swift build
swift test
```

`swift test` needs the XCTest that ships with Xcode. The integration tests create temporary repositories, worktrees and a local remote, and never touch your own repositories.

The layout is small: `Sources/RatelGitCore` runs Git and parses its output, `Sources/RatelGit` holds the SwiftUI app, and `scripts/make-icon.swift` redraws the app icon.

## License

MIT
