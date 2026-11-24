/** How the fake core changes its world for each action. */

import { BridgeError } from "../bridge";
import type { Action, ChangedFile } from "../types";
import { fakeHash } from "./ids";
import type { FakeCommit } from "./history";
import { diffKey } from "./diffs";
import { findTree, type FakeTree, type FakeWorld } from "./world";
import { applyWorkingAction } from "./working";

type TreeChange = (tree: FakeTree) => FakeTree;

function updateTree(
  world: FakeWorld,
  path: string,
  change: TreeChange,
): FakeWorld {
  return {
    ...world,
    projects: world.projects.map((project) => ({
      ...project,
      trees: project.trees.map((tree) =>
        tree.path === path ? change(tree) : tree,
      ),
    })),
  };
}

const same = (a: ChangedFile, b: ChangedFile) =>
  a.path === b.path && a.kind === b.kind;

function expectFile(tree: FakeTree, file: ChangedFile) {
  if (!tree.files.some((f) => same(f, file))) {
    throw new BridgeError(
      "stale",
      "The file status changed. Refresh and try again.",
    );
  }
}

function moveFile(
  tree: FakeTree,
  file: ChangedFile,
  kind: ChangedFile["kind"] | null,
): FakeTree {
  expectFile(tree, file);
  const rest = tree.files.filter((f) => !same(f, file));
  if (kind === null) return { ...tree, files: rest };
  const status =
    file.kind === "untracked" ? "A" : file.status === "U" ? "M" : file.status;
  const moved = {
    path: file.path,
    kind,
    status: kind === "untracked" ? "?" : status,
    conflict: null,
  };
  const merged = rest.some((f) => f.path === file.path && f.kind === kind)
    ? rest
    : [...rest, moved];
  return { ...tree, files: merged };
}

function resolve(tree: FakeTree, file: ChangedFile): FakeTree {
  if (file.status !== "U")
    throw new BridgeError("stale", "The file is no longer conflicted.");
  return moveFile(tree, file, "staged");
}

function commitTree(
  world: FakeWorld,
  path: string,
  subject: string,
): FakeWorld {
  const [project, tree] = findTree(world, path);
  const commit: FakeCommit = {
    hash: fakeHash(`${path}:${subject}:${project.commits.length}`),
    subject,
    body: "",
    author: "Mina Park",
    email: "mina@example.invalid",
    date: "2026-02-28T09:00:00+00:00",
    parents: [tree.head],
    files: tree.files
      .filter((f) => f.kind === "staged")
      .map((f) => ({ path: f.path, status: f.status })),
  };
  const moved = {
    ...world,
    projects: world.projects.map((p) =>
      p.path !== project.path
        ? p
        : {
            ...p,
            commits: [commit, ...p.commits],
            refs: p.refs.map((r) =>
              r.kind === "local" && r.name === tree.branch
                ? { ...r, target: commit.hash }
                : r,
            ),
          },
    ),
  };
  return updateTree(moved, path, (t) => ({
    ...t,
    head: commit.hash,
    operation: null,
    files: t.files.filter((f) => f.kind !== "staged"),
  }));
}

function conflictChange(tree: FakeTree, action: Action): FakeTree | null {
  switch (action.type) {
    case "deleteFile":
      if (!tree.files.some((f) => same(f, action.file))) {
        throw new BridgeError("stale", "The file is no longer conflicted.");
      }
      return {
        ...tree,
        files: tree.files.filter((f) => !same(f, action.file)),
      };
    case "keepFile":
      return resolve(tree, action.file);
    case "abort":
      return {
        ...tree,
        operation: null,
        files: tree.files.filter((f) => f.status !== "U"),
      };
    default:
      return null;
  }
}

/** Conflict resolutions stage the file with a small resolved diff. */
function resolveAction(
  world: FakeWorld,
  path: string,
  action: Action,
): FakeWorld | null {
  if (
    !["resolveSide", "markResolved", "saveResolution"].includes(action.type) ||
    !("file" in action)
  ) {
    return null;
  }
  const [, tree] = findTree(world, path);
  const file = action.file;
  if (file.status !== "U" || !tree.files.some((f) => same(f, file))) {
    throw new BridgeError("stale", "The file is no longer conflicted.");
  }
  const staged = {
    path: file.path,
    kind: "staged" as const,
    status: "M",
    conflict: null,
  };
  const text = `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n@@ -1 +1 @@\n-before\n+resolved\n`;
  return {
    ...updateTree(world, path, (t) => ({
      ...t,
      files: [...t.files.filter((f) => !same(f, file)), staged],
    })),
    diffs: { ...world.diffs, [diffKey(path, "staged", file.path)]: text },
  };
}

export function applyFakeAction(
  world: FakeWorld,
  path: string,
  action: Action,
): FakeWorld {
  const working = applyWorkingAction(world, path, action);
  if (working) return working;
  const resolved = resolveAction(world, path, action);
  if (resolved) return resolved;
  const [, tree] = findTree(world, path);
  const changed = conflictChange(tree, action);
  if (changed) return updateTree(world, path, () => changed);
  switch (action.type) {
    case "commit":
      if (!action.message.trim())
        throw new BridgeError("invalid_input", "Enter a commit message.");
      return commitTree(world, path, action.message.trim().split("\n")[0]);
    case "continue":
      if (tree.files.some((f) => f.status === "U")) {
        throw new BridgeError(
          "invalid_input",
          "Resolve and stage every conflicted file before continuing.",
        );
      }
      return commitTree(
        world,
        path,
        action.message?.split("\n")[0] ?? tree.operation?.message ?? "Merge",
      );
    case "deleteBranch":
      if (!action.force && action.reference.includes("auth")) {
        throw new BridgeError(
          "not_fully_merged",
          `error: the branch '${action.reference.slice(11)}' is not fully merged.`,
        );
      }
      return {
        ...world,
        projects: world.projects.map((p) => ({
          ...p,
          refs: p.refs.filter((r) => r.id !== action.reference),
        })),
      };
    default:
      return world;
  }
}
