/**
 * Stage, unstage, discard and line actions in the fake core. Each one checks that the file is
 * listed as the UI says, line actions check that `source` is the current diff (as the real
 * core does), and the diffs and file list change the way Git's would.
 */

import { BridgeError } from "../bridge";
import type { Action, ChangedFile, ChangeKind } from "../types";
import {
  afterApplying,
  afterReverting,
  allChanged,
  combine,
  diffKey,
  onlySelected,
} from "./diffs";
import type { FakeTree, FakeWorld } from "./world";

const stale = (message = "The file status changed. Refresh and try again.") =>
  new BridgeError("stale", message);

function treeOf(world: FakeWorld, worktree: string): FakeTree {
  const tree = world.projects
    .flatMap((p) => p.trees)
    .find((t) => t.path === worktree);
  if (!tree) throw new BridgeError("not_found", "Unknown worktree.");
  return tree;
}

function expectListed(tree: FakeTree, file: ChangedFile) {
  const listed = tree.files.some(
    (f) =>
      f.path === file.path && f.kind === file.kind && f.status === file.status,
  );
  if (!listed) throw stale();
}

/** Status letter a file gets on one side after lines moved there. */
function statusFor(kind: ChangeKind, from: ChangedFile): string {
  if (kind === "untracked") return "?";
  if (from.kind === "untracked" || from.status === "A") return "A";
  return from.status === "U" ? "M" : from.status;
}

/** Writes the new diffs of one path and lists the file on each side that still has one. */
function settle(
  world: FakeWorld,
  worktree: string,
  file: ChangedFile,
  diffs: Partial<Record<ChangeKind, string | null>>,
): FakeWorld {
  const next = { ...world.diffs };
  (Object.keys(diffs) as ChangeKind[]).forEach((kind) => {
    const key = diffKey(worktree, kind, file.path);
    const text = diffs[kind];
    if (text) next[key] = text;
    else delete next[key];
  });
  const kinds: ChangeKind[] = ["staged", "unstaged", "untracked"];
  const tree = treeOf(world, worktree);
  const others = tree.files.filter((f) => f.path !== file.path);
  const listed = kinds.flatMap((kind) => {
    if (!next[diffKey(worktree, kind, file.path)]) return [];
    const existing = tree.files.find(
      (f) => f.path === file.path && f.kind === kind && f.status !== "U",
    );
    return [
      existing ?? {
        path: file.path,
        kind,
        status: statusFor(kind, file),
        conflict: null,
      },
    ];
  });
  return {
    ...world,
    diffs: next,
    projects: world.projects.map((p) => ({
      ...p,
      trees: p.trees.map((t) =>
        t.path === worktree ? { ...t, files: [...others, ...listed] } : t,
      ),
    })),
  };
}

const read = (
  world: FakeWorld,
  worktree: string,
  kind: ChangeKind,
  path: string,
) => world.diffs[diffKey(worktree, kind, path)];

function lineAction(
  world: FakeWorld,
  worktree: string,
  action: Extract<Action, { type: "applyLines" }>,
) {
  const { file, source, operation } = action;
  if (read(world, worktree, file.kind, file.path) !== source) {
    throw stale(
      "The file changed since its diff was shown. Refresh and try again.",
    );
  }
  const selected = new Set(action.lines);
  if (operation === "stage") {
    const staged = combine(
      read(world, worktree, "staged", file.path),
      onlySelected(source, selected),
    );
    return settle(world, worktree, file, {
      unstaged: afterApplying(source, selected),
      staged,
    });
  }
  if (operation === "unstage") {
    const unstaged = combine(
      read(world, worktree, "unstaged", file.path),
      onlySelected(source, selected),
    );
    return settle(world, worktree, file, {
      staged: afterReverting(source, selected),
      unstaged,
    });
  }
  return settle(world, worktree, file, {
    unstaged: afterReverting(source, selected),
  });
}

/** The world after a working-tree action, or null when `action` is not one. */
export function applyWorkingAction(
  world: FakeWorld,
  worktree: string,
  action: Action,
): FakeWorld | null {
  if (
    !("file" in action) ||
    action.type === "deleteFile" ||
    action.type === "keepFile"
  )
    return null;
  const tree = treeOf(world, worktree);
  expectListed(tree, action.file);
  const { file } = action;
  const own = read(world, worktree, file.kind, file.path) ?? "";
  switch (action.type) {
    case "stage": {
      const staged = combine(
        read(world, worktree, "staged", file.path),
        own || allChangedText(file),
      );
      return settle(world, worktree, file, { [file.kind]: null, staged });
    }
    case "unstage": {
      const target: ChangeKind = file.status === "A" ? "untracked" : "unstaged";
      const back = combine(read(world, worktree, target, file.path), own);
      return settle(world, worktree, file, { staged: null, [target]: back });
    }
    case "discard":
      return settle(world, worktree, file, { [file.kind]: null });
    case "applyLines":
      return lineAction(world, worktree, action);
    default:
      return null;
  }
}

/** A conflicted file staged as resolved shows a small diff. */
function allChangedText(file: ChangedFile): string {
  return `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n@@ -1 +1 @@\n-<<<<<<< conflict\n+resolved\n`;
}

export { allChanged };
