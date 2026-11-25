import type { Action, ChangedFile, OperationState, Reference } from "../bridge";
import { OPERATION_NAMES } from "../lib/conflict";
import type { Confirmation, Prompt } from "./types";

const quote = (text: string) => `“${text}”`;

export function discardConfirmation(file: ChangedFile): Confirmation {
  const untracked = file.kind === "untracked";
  return {
    title: untracked ? "Delete Untracked File?" : "Discard Changes?",
    message: untracked
      ? `${quote(file.path)} is not tracked by Git. It will be deleted from disk and cannot be recovered.`
      : `Unstaged changes to ${quote(file.path)} will be lost. Staged changes are kept. This cannot be undone.`,
    confirm: untracked ? "Delete File" : "Discard",
    label: "Discard",
    action: { type: "discard", file },
    destructive: true,
  };
}

export function discardLinesConfirmation(
  file: ChangedFile,
  source: string,
  lines: number[],
  hunk: boolean,
): Confirmation {
  const scope = hunk
    ? "this hunk"
    : lines.length === 1
      ? "1 selected line"
      : `${lines.length} selected lines`;
  return {
    title: "Discard Changes?",
    message: `Unstaged changes in ${scope} of ${quote(file.path)} will be lost. This cannot be undone.`,
    confirm: "Discard",
    label: "Discard",
    action: { type: "applyLines", file, source, lines, operation: "discard" },
    destructive: true,
  };
}

export function deleteBranchConfirmation(reference: Reference): Confirmation {
  return {
    title: `Delete Branch ${quote(reference.name)}?`,
    message:
      "The branch is deleted only if it is merged. Its commits stay reachable from other refs.",
    confirm: "Delete",
    label: "Delete Branch",
    action: { type: "deleteBranch", reference: reference.id, force: false },
    destructive: true,
  };
}

export function forceDeleteConfirmation(reference: string): Confirmation {
  const name = reference.replace(/^refs\/heads\//, "");
  return {
    title: `${quote(name)} Is Not Fully Merged`,
    message:
      "Deleting it anyway can leave its commits unreachable. They may be lost when Git cleans up.",
    confirm: "Force Delete",
    label: "Delete Branch",
    action: { type: "deleteBranch", reference, force: true },
    destructive: true,
  };
}

export function dropStashConfirmation(stash: Reference): Confirmation {
  return {
    title: "Drop Stash?",
    message: `${stash.name} (${stash.subject ?? ""}) will be removed from the stash list. This cannot be undone.`,
    confirm: "Drop",
    label: "Drop Stash",
    action: {
      type: "dropStash",
      stash: stash.id,
      revision: stash.target ?? "",
    },
    destructive: true,
  };
}

export function abortConfirmation(operation: OperationState): Confirmation {
  const name = OPERATION_NAMES[operation.kind];
  return {
    title: `Abort ${name}?`,
    message: `The worktree returns to where it was before the ${name.toLowerCase()}. Conflict resolutions you made are lost.`,
    confirm: `Abort ${name}`,
    label: `Abort ${name}`,
    action: { type: "abort", operation: operation.kind },
    destructive: true,
  };
}

export function deleteConflictedConfirmation(file: ChangedFile): Confirmation {
  return {
    title: "Delete File?",
    message: `${quote(file.path)} will be removed from the work tree and the index to resolve the conflict.`,
    confirm: "Delete File",
    label: "Delete File",
    action: { type: "deleteFile", file },
    destructive: true,
  };
}

export function forceResolveConfirmation(file: ChangedFile): Confirmation {
  return {
    title: "Conflict Markers Remain",
    message: `${quote(file.path)} still contains <<<<<<< or >>>>>>> lines. Mark it resolved anyway?`,
    confirm: "Mark Resolved",
    label: "Mark Resolved",
    action: { type: "markResolved", file, force: true },
    destructive: true,
  };
}

const prompt = (
  fields: Partial<Prompt> & Pick<Prompt, "kind" | "title" | "confirm">,
): Prompt => ({
  message: "",
  placeholder: "",
  initial: "",
  multiline: false,
  reference: null,
  operation: null,
  ...fields,
});

export const createBranchPrompt = () =>
  prompt({
    kind: "createBranch",
    title: "Create and Switch to Branch",
    message: "Create a branch from this worktree's HEAD.",
    placeholder: "Branch name",
    confirm: "Create",
  });

export const stashPrompt = () =>
  prompt({
    kind: "stash",
    title: "Stash Changes",
    message: "Save staged, unstaged and untracked changes from this worktree.",
    placeholder: "Message (optional)",
    confirm: "Stash",
  });

export const renamePrompt = (reference: Reference) =>
  prompt({
    kind: "rename",
    title: `Rename Branch ${quote(reference.name)}`,
    message: "Enter the new branch name.",
    placeholder: "Branch name",
    confirm: "Rename",
    initial: reference.name,
    reference,
  });

export const mergeMessagePrompt = (operation: OperationState) =>
  prompt({
    kind: "mergeMessage",
    title: "Commit Merge",
    message:
      "All conflicts are resolved. Edit the merge commit message if you like.",
    placeholder: "Merge message",
    confirm: "Commit Merge",
    initial: operation.message ?? "",
    multiline: true,
    operation,
  });

/** The action a submitted prompt runs, with its progress label. */
export function promptAction(
  current: Prompt,
  text: string,
): [Action, string] | null {
  switch (current.kind) {
    case "createBranch":
      return [{ type: "createBranch", name: text.trim() }, "Create Branch"];
    case "stash":
      return [{ type: "stash", message: text }, "Stash"];
    case "rename":
      return current.reference
        ? [
            {
              type: "renameBranch",
              reference: current.reference.id,
              name: text.trim(),
            },
            "Rename Branch",
          ]
        : null;
    case "mergeMessage":
      return current.operation
        ? [
            {
              type: "continue",
              operation: current.operation.kind,
              message: text,
            },
            "Commit Merge",
          ]
        : null;
  }
}
