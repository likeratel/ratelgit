/**
 * In-memory stand-in for the Rust core, used by the browser preview, store tests and the
 * Playwright tests. It follows CONTRACT.md closely enough to exercise every view; it does not
 * run Git.
 */

import {
  BridgeError,
  type Bridge,
  type BridgeErrorKind,
  type HistoryFilterRequest,
} from "../bridge";
import type {
  Action,
  ChangedFile,
  ConflictDocument,
  Platform,
  Project,
  Reference,
  Worktree,
  WorktreeSnapshot,
} from "../types";
import { reachable, toLine, type FakeCommit } from "./history";
import { applyFakeAction } from "./actions";
import { diffKey } from "./diffs";
import {
  commitFileDiff,
  createWorld,
  emptyWorld,
  findTree,
  type FakeProject,
  type FakeTree,
  type FakeWorld,
} from "./world";

export interface FakeCall {
  command: string;
  args: unknown[];
}

export interface FakeControls {
  /** Delay before each response, in milliseconds. A function can vary it per call. */
  setLatency(latency: number | ((call: FakeCall) => number)): void;
  /** Makes the next call of `command` fail with this error. */
  failNext(command: string, kind: BridgeErrorKind, message: string): void;
  calls(): FakeCall[];
  actions(): Action[];
  reset(): void;
}

const PAGE_SIZE = 500;

const baseName = (path: string) =>
  path.split("/").filter(Boolean).at(-1) ?? path;

function toWorktree(tree: FakeTree, index: number): Worktree {
  const changes = new Set(tree.files.map((f) => f.path)).size;
  return {
    path: tree.path,
    name: baseName(tree.path),
    branch: tree.branch,
    isMain: index === 0,
    unavailable: false,
    changes,
    ahead: tree.tracking?.ahead ?? null,
    behind: tree.tracking?.behind ?? null,
  };
}

function toProject(project: FakeProject): Project {
  return {
    path: project.path,
    name: baseName(project.path),
    state: "ready",
    reason: null,
    worktrees: project.trees.map(toWorktree),
  };
}

function decorations(
  project: FakeProject,
  tree: FakeTree,
  commit: FakeCommit,
): string[] {
  const at = project.refs.filter(
    (r) => r.kind !== "stash" && r.target === commit.hash,
  );
  return at.map((r) => {
    if (r.kind === "tag") return `tag: ${r.name}`;
    if (r.kind === "local" && r.name === tree.branch)
      return `HEAD -> ${r.name}`;
    return r.name;
  });
}

function refsForTree(project: FakeProject, tree: FakeTree): Reference[] {
  return project.refs.map((r) => ({
    ...r,
    isHead: r.kind === "local" && r.name === tree.branch,
  }));
}

function listing(
  project: FakeProject,
  tree: FakeTree,
  filter: readonly string[],
) {
  const heads =
    filter.length === 0
      ? [
          ...project.refs
            .filter((r) => r.kind !== "stash")
            .map((r) => r.target ?? ""),
          tree.head,
        ]
      : filter.map((id) =>
          id === "HEAD"
            ? tree.head
            : (project.refs.find((r) => r.id === id)?.target ?? ""),
        );
  return reachable(project.commits, heads);
}

function page(
  project: FakeProject,
  tree: FakeTree,
  filter: readonly string[],
  skip: number,
) {
  const commits = listing(project, tree, filter);
  const lines = commits
    .slice(skip, skip + PAGE_SIZE)
    .map((c, i) => toLine(c, skip + i, decorations(project, tree, c)));
  return { lines, complete: skip + PAGE_SIZE >= commits.length };
}

const MAINLINES = ["refs/remotes/origin/main", "refs/remotes/origin/master"];

/** As in the core: HEAD plus origin/main and origin/master when they exist. */
function defaultFilter(project: FakeProject): string[] {
  return [
    "HEAD",
    ...MAINLINES.filter((id) => project.refs.some((r) => r.id === id)),
  ];
}

function snapshot(
  world: FakeWorld,
  path: string,
  requested: HistoryFilterRequest,
): WorktreeSnapshot {
  const [project, tree] = findTree(world, path);
  const fallback = defaultFilter(project);
  const filter = requested ?? fallback;
  const pruned = filter.filter(
    (id) => id === "HEAD" || project.refs.some((r) => r.id === id),
  );
  const visible = new Set(listing(project, tree, pruned).map((c) => c.hash));
  return {
    references: refsForTree(project, tree),
    filter: pruned,
    defaultFilter: fallback,
    history: page(project, tree, pruned, 0),
    headHidden: pruned.length > 0 && !visible.has(tree.head),
    files: tree.files,
    tracking: tree.tracking,
    operation: tree.operation
      ? {
          ...tree.operation,
          conflicts: tree.files.filter((f) => f.status === "U").length,
        }
      : null,
  };
}

function diffFor(
  world: FakeWorld,
  worktree: string,
  file: ChangedFile,
  commit: string | null,
  project?: FakeProject,
) {
  if (file.kind === "committed") {
    const subject =
      project?.commits.find((c) => c.hash === commit)?.subject ?? "";
    return commitFileDiff(file.path, subject);
  }
  return world.diffs[diffKey(worktree, file.kind, file.path)] ?? "";
}

export interface FakeOptions {
  /** Start with no projects, as on a first launch. */
  empty?: boolean;
}

export function createFakeBridge(
  platform: Platform = "macos",
  options: FakeOptions = {},
): Bridge & { controls: FakeControls } {
  const fresh = () => (options.empty ? emptyWorld() : createWorld());
  let world = fresh();
  let latency: number | ((call: FakeCall) => number) = 0;
  let calls: FakeCall[] = [];
  let failures: Record<string, BridgeError> = {};

  async function respond<T>(
    command: string,
    args: unknown[],
    produce: () => T,
  ): Promise<T> {
    const call = { command, args };
    calls = [...calls, call];
    const delay = typeof latency === "function" ? latency(call) : latency;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const failure = failures[command];
    if (failure) {
      failures = Object.fromEntries(
        Object.entries(failures).filter(([key]) => key !== command),
      );
      throw failure;
    }
    return structuredClone(produce());
  }

  const controls: FakeControls = {
    setLatency: (next) => {
      latency = next;
    },
    failNext: (command, kind, message) => {
      failures = { ...failures, [command]: new BridgeError(kind, message) };
    },
    calls: () => calls,
    actions: () =>
      calls
        .filter((c) => c.command === "runAction")
        .map((c) => c.args[1] as Action),
    reset: () => {
      world = fresh();
      calls = [];
      failures = {};
      latency = 0;
    },
  };

  return {
    controls,
    getBootstrap: () =>
      respond("getBootstrap", [], () => ({
        preferences: world.preferences,
        platform,
      })),
    listProjects: () =>
      respond("listProjects", [], () => world.projects.map(toProject)),
    addProject: () => respond("addProject", [], () => null),
    removeProject: (path) =>
      respond("removeProject", [path], () => {
        world = {
          ...world,
          projects: world.projects.filter((p) => p.path !== path),
        };
        return world.projects.map((p) => p.path);
      }),
    listWorktrees: (worktree) =>
      respond("listWorktrees", [worktree], () =>
        findTree(world, worktree)[0].trees.map(toWorktree),
      ),
    loadWorktree: (worktree, filter) =>
      respond("loadWorktree", [worktree, filter], () =>
        snapshot(world, worktree, filter),
      ),
    loadHistory: (worktree, filter, skip) =>
      respond("loadHistory", [worktree, filter, skip], () => {
        const [project, tree] = findTree(world, worktree);
        return page(project, tree, filter ?? defaultFilter(project), skip);
      }),
    loadCommit: (worktree, hash) =>
      respond("loadCommit", [worktree, hash], () => {
        const [project] = findTree(world, worktree);
        const commit = project.commits.find((c) => c.hash === hash);
        if (!commit) throw new BridgeError("git_failed", "Unknown commit.");
        return {
          detail: {
            hash: commit.hash,
            parents: commit.parents,
            author: commit.author,
            email: commit.email,
            date: commit.date,
            message: commit.body
              ? `${commit.subject}\n\n${commit.body}`
              : commit.subject,
          },
          files: commit.files.map((f) => ({
            ...f,
            kind: "committed" as const,
            conflict: null,
          })),
        };
      }),
    loadDiff: (worktree, file, commit, ignoreWhitespace) =>
      respond("loadDiff", [worktree, file, commit, ignoreWhitespace], () => {
        const [project] = findTree(world, worktree);
        return {
          text: diffFor(world, worktree, file, commit, project),
          lossy: false,
          truncated: false,
        };
      }),
    loadConflict: (worktree, path) =>
      respond("loadConflict", [worktree, path], (): ConflictDocument => {
        findTree(world, worktree);
        return (
          world.conflicts[`${worktree}|${path}`] ?? {
            path,
            state: "missing",
            reason: "The file is not in the work tree.",
            fingerprint: null,
            segments: [],
          }
        );
      }),
    openFile: (worktree, path) =>
      respond("openFile", [worktree, path], () => ({
        action: /\.(sh|exe|bat|cmd|command)$/i.test(path)
          ? ("revealed" as const)
          : ("opened" as const),
      })),
    chooseWorktreeParent: () =>
      respond("chooseWorktreeParent", [], () => ({
        token: "parent-1",
        path: "/work/trees",
      })),
    runAction: (worktree, action) =>
      respond("runAction", [worktree, action], () => {
        world = applyFakeAction(world, worktree, action);
      }),
    savePreferences: (filters, ui) =>
      respond("savePreferences", [filters, ui], () => {
        world = {
          ...world,
          preferences: {
            ...world.preferences,
            filters: Object.fromEntries(
              Object.entries(filters).map(([k, v]) => [k, [...v]]),
            ),
            ui,
          },
        };
        return world.preferences;
      }),
  };
}
