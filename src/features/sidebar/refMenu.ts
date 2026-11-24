import type { Reference } from "../../bridge";
import {
  addWorktreePrompt,
  deleteBranchConfirmation,
  dropStashConfirmation,
  renamePrompt,
} from "../../state/dialogs";
import { activeFilter } from "../../state/helpers";
import type { AppState } from "../../state/types";
import type { MenuItem } from "../../ui/menu";

/** Context menu for a branch, remote branch, tag or stash in the sidebar. */
export function referenceMenu(
  reference: Reference,
  state: AppState,
): MenuItem[] {
  const filtered = activeFilter(state).includes(reference.id);
  const filterItems: MenuItem[] = [
    {
      label:
        reference.kind === "tag"
          ? "Show Only This Tag"
          : "Show Only This Branch",
      separator: true,
      onSelect: () => state.filterTo(reference.id),
    },
    {
      label: filtered ? "Remove from History Filter" : "Add to History Filter",
      onSelect: () => state.toggleFilter([reference.id]),
    },
  ];
  const run =
    (action: Parameters<AppState["execute"]>[0], label: string) => () =>
      void state.execute(action, label);
  const elsewhere =
    reference.worktreePath !== null &&
    reference.worktreePath !== state.activePath;
  const current =
    state.references.find((r) => r.kind === "local" && r.isHead)?.name ??
    "the current branch";

  switch (reference.kind) {
    case "local":
      return [
        {
          label: "Check Out",
          disabled: reference.isHead || elsewhere,
          onSelect: run(
            { type: "switchBranch", reference: reference.id },
            "Check Out",
          ),
        },
        {
          label: `Merge into ${current}`,
          disabled: reference.isHead,
          onSelect: run({ type: "merge", reference: reference.id }, "Merge"),
        },
        {
          label: `Rebase ${current} onto This`,
          disabled: reference.isHead,
          onSelect: run({ type: "rebase", reference: reference.id }, "Rebase"),
        },
        {
          label: "Check Out in New Worktree…",
          separator: true,
          disabled: reference.worktreePath !== null || !state.projectPath,
          onSelect: () =>
            state.projectPath &&
            state.ask(addWorktreePrompt(reference, state.projectPath)),
        },
        {
          label: "Rename…",
          separator: true,
          onSelect: () => state.ask(renamePrompt(reference)),
        },
        {
          label: "Delete…",
          destructive: true,
          disabled: reference.worktreePath !== null,
          onSelect: () => state.confirm(deleteBranchConfirmation(reference)),
        },
        ...filterItems,
      ];
    case "remote":
      return [
        {
          label: "Check Out as Local Tracking Branch",
          onSelect: run(
            { type: "checkoutRemote", reference: reference.id },
            "Check Out",
          ),
        },
        ...filterItems,
      ];
    case "tag":
      return filterItems.map((item, index) =>
        index === 0 ? { ...item, separator: false } : item,
      );
    case "stash":
      return [
        {
          label: "Apply in This Worktree",
          onSelect: run(
            {
              type: "applyStash",
              stash: reference.id,
              revision: reference.target ?? "",
            },
            "Apply Stash",
          ),
        },
        {
          label: "Drop…",
          separator: true,
          destructive: true,
          onSelect: () => state.confirm(dropStashConfirmation(reference)),
        },
      ];
  }
}
