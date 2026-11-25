/** Logic of the new-worktree and remove-worktree dialogs. */

import type { Reference, RemovalPreview, RemoveOptions } from "../bridge/types";
import { plural } from "./format";

const START_POINTS = ["refs/remotes/origin/main", "refs/remotes/origin/master"];

/** Where a new branch starts: origin/main, else origin/master, else the current HEAD. */
export function defaultStartPoint(references: readonly Reference[]): string {
  return (
    START_POINTS.find((id) => references.some((r) => r.id === id)) ?? "HEAD"
  );
}

/** Folder name suggested for a branch: `feature/x` becomes `feature-x`. */
export function folderNameFor(branch: string): string {
  return branch.trim().replace(/[\\/]+/g, "-");
}

/** Local branches no worktree has checked out. */
export function freeLocalBranches(
  references: readonly Reference[],
): Reference[] {
  return references.filter(
    (r) => r.kind === "local" && r.worktreePath === null,
  );
}

export function remoteBranches(references: readonly Reference[]): Reference[] {
  return references.filter(
    (r) => r.kind === "remote" && !r.name.endsWith("/HEAD"),
  );
}

/** Refs a new branch can start from. */
export function startPoints(references: readonly Reference[]): Reference[] {
  return references.filter(
    (r) => r.kind !== "stash" && !r.name.endsWith("/HEAD"),
  );
}

export interface RemovalChoices {
  deleteBranch: boolean;
  deleteRemote: boolean;
  /** "I understand these will be lost". */
  acknowledged: boolean;
}

/** The local branch goes by default unless it must stay; the remote branch never by default. */
export function initialRemoval(preview: RemovalPreview): RemovalChoices {
  return {
    deleteBranch: preview.branch !== null && preview.branchBlock === null,
    deleteRemote: false,
    acknowledged: false,
  };
}

/** Commits the chosen deletions leave on no ref, as the core counts them. */
export function commitsLost(
  preview: RemovalPreview,
  choices: RemovalChoices,
): number {
  if (preview.branch === null) return preview.unmergedCommits;
  if (!choices.deleteBranch) return 0;
  return choices.deleteRemote && preview.remoteBlock === null
    ? preview.unmergedWithRemote
    : preview.unmergedCommits;
}

const joinNames = (names: string[]) =>
  names.length <= 1
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** Everything that would be lost or overridden, one sentence each. */
export function removalWarnings(
  preview: RemovalPreview,
  choices: RemovalChoices,
): string[] {
  const warnings: string[] = [];
  if (preview.locked !== null) {
    warnings.push(
      `The worktree is locked${preview.locked ? ` (${preview.locked})` : ""}; it will be removed anyway.`,
    );
  }
  if (preview.operation) {
    warnings.push(
      `A ${preview.operation === "cherryPick" ? "cherry-pick" : preview.operation} is stopped in this worktree; it will be thrown away.`,
    );
  }
  const lost = [
    preview.changes ? plural(preview.changes, "changed file") : "",
    preview.untracked ? plural(preview.untracked, "untracked file") : "",
  ].filter(Boolean);
  if (lost.length) {
    warnings.push(
      `${lost.join(" and ")} will be permanently deleted with the folder.`,
    );
  }
  if (preview.ignored > 0) {
    const examples = preview.ignoredExamples.length
      ? `, such as ${joinNames(preview.ignoredExamples)},`
      : "";
    warnings.push(
      `${plural(preview.ignored, "ignored file or folder", "ignored files or folders")}${examples} will be permanently deleted. Git does not track them, so this may be the only copy.`,
    );
  }
  if (preview.submodules) {
    warnings.push(
      "This repository has submodules; Git needs force to remove the worktree, and any checked-out submodule folders are deleted too.",
    );
  }
  const commits = commitsLost(preview, choices);
  if (commits > 0) {
    const what = preview.branch
      ? `the branch \u201c${preview.branch}\u201d`
      : "the detached HEAD";
    const verb = commits === 1 ? "is" : "are";
    const where =
      choices.deleteRemote && preview.branch
        ? " once the remote branch is deleted too"
        : "";
    warnings.push(
      `${plural(commits, "commit")} of ${what} ${verb} on no other branch, remote branch or tag${where} and will be lost.`,
    );
  }
  return warnings;
}

/** Applies a checkbox change. A remote branch that must stay is never chosen, it goes when
 * the local branch stays, and a warning that was not there before needs a new "I understand". */
export function changeRemoval(
  preview: RemovalPreview,
  current: RemovalChoices,
  change: Partial<Omit<RemovalChoices, "acknowledged">>,
): RemovalChoices {
  const merged = { ...current, ...change };
  const deleteRemote =
    merged.deleteRemote &&
    merged.deleteBranch &&
    preview.remoteBlock === null &&
    preview.upstream !== null;
  const next = { ...merged, deleteRemote };
  const before = new Set(removalWarnings(preview, current));
  const added = removalWarnings(preview, next).some(
    (warning) => !before.has(warning),
  );
  return { ...next, acknowledged: added ? false : current.acknowledged };
}

export function canRemove(
  preview: RemovalPreview,
  choices: RemovalChoices,
): boolean {
  return removalWarnings(preview, choices).length === 0 || choices.acknowledged;
}

export function removeOptions(
  preview: RemovalPreview,
  choices: RemovalChoices,
): RemoveOptions {
  const deleteBranch =
    choices.deleteBranch &&
    preview.branch !== null &&
    preview.branchBlock === null;
  const deleteRemote =
    deleteBranch &&
    choices.deleteRemote &&
    preview.upstream !== null &&
    preview.remoteBlock === null;
  const effective = { ...choices, deleteBranch, deleteRemote };
  const lostCommits = commitsLost(preview, effective);
  return {
    seen: {
      changes: preview.changes,
      untracked: preview.untracked,
      ignored: preview.ignored,
      lostCommits,
      locked: preview.locked !== null,
      operation: preview.operation !== null,
      submodules: preview.submodules,
      tip: preview.tip,
    },
    force:
      preview.locked !== null ||
      preview.operation !== null ||
      preview.changes + preview.untracked + preview.ignored > 0 ||
      preview.submodules,
    deleteBranch,
    allowUnmerged: lostCommits > 0,
    deleteRemote,
  };
}
