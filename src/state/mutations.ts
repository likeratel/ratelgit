import {
  errorKind,
  errorMessage,
  type Action,
  type Bridge,
  type ChangedFile,
  type Worktree,
  type WorktreeSnapshot,
} from "../bridge";
import { renameRef } from "../lib/historyFilter";
import { forceDeleteConfirmation, forceResolveConfirmation } from "./dialogs";
import {
  filterSetting,
  describe,
  projectOf,
  sameFile,
  samePath,
} from "./helpers";
import type { Tokens } from "./tokens";
import type { GetState, Operations, SetState } from "./types";
import { applySnapshot } from "./workspace";

type MutationOps = Pick<Operations, "execute"> & {
  /** Re-reads worktrees and the snapshot of `worktree`, then shows `previous` again. */
  refreshWorktree(
    worktree: string,
    previous: ChangedFile | null,
  ): Promise<RefreshResult | null>;
};

export interface RefreshResult {
  trees: Worktree[];
  snapshot: WorktreeSnapshot;
}

/** Actions after which the selected commit may no longer be where it was. */
const KEEPS_HISTORY = new Set<Action["type"]>([
  "stage",
  "unstage",
  "discard",
  "applyLines",
  "stash",
  "applyStash",
  "dropStash",
  "resolveSide",
  "keepFile",
  "deleteFile",
  "markResolved",
  "saveResolution",
]);

/** The same path again after an action, preferring the side the user was looking at. A file
 * that was staged whole moves to the staged side, and the selection follows it. */
export function followFile(
  files: readonly ChangedFile[],
  previous: ChangedFile,
): ChangedFile | null {
  const candidates = files.filter((f) => f.path === previous.path);
  return (
    candidates.find(
      (f) => sameFile(f, previous) && f.status === previous.status,
    ) ??
    candidates.find((f) => sameFile(f, previous)) ??
    candidates[0] ??
    null
  );
}

export function mutationOperations(
  set: SetState,
  get: GetState,
  bridge: Bridge,
  tokens: Tokens,
  showFile: (file: ChangedFile, quiet?: boolean) => Promise<void>,
  selectWorktree: (path: string) => void,
  persist: () => void,
): MutationOps {
  const failed = (action: Action, label: string, error: unknown) => {
    const kind = errorKind(error);
    if (
      action.type === "deleteBranch" &&
      !action.force &&
      kind === "not_fully_merged"
    ) {
      set({ confirmation: forceDeleteConfirmation(action.reference) });
    } else if (
      action.type === "markResolved" &&
      !action.force &&
      kind === "conflict_markers"
    ) {
      set({ confirmation: forceResolveConfirmation(action.file) });
    } else {
      set({ error: describe(label, error) });
    }
  };

  const succeeded = (action: Action, worktree: string) => {
    const state = get();
    // Only a commit made from the message box uses the draft; a merge commit has its own.
    if (action.type === "commit")
      set({ drafts: { ...state.drafts, [worktree]: "" } });
    // The default filter holds no branch names, so only a chosen filter needs renaming.
    const current = state.projectPath
      ? state.filters[state.projectPath]
      : undefined;
    if (action.type === "renameBranch" && state.projectPath && current) {
      const renamed = renameRef(
        current,
        action.reference,
        `refs/heads/${action.name}`,
      );
      set({ filters: { ...state.filters, [state.projectPath]: renamed } });
      persist();
    }
  };

  const refreshWorktree = async (
    worktree: string,
    previous: ChangedFile | null,
  ) => {
    const token = tokens.next("workspace");
    const [trees, snapshot] = await Promise.all([
      bridge.listWorktrees(worktree),
      bridge.loadWorktree(worktree, filterSetting(get())),
    ]);
    if (!tokens.current("workspace", token) || get().activePath !== worktree)
      return null;
    const projects = get().projects.map((p) =>
      p.worktrees.some((t) => t.path === worktree)
        ? { ...p, worktrees: trees }
        : p,
    );
    set({ projects });
    applySnapshot(set, get, snapshot, token);
    const next = previous ? followFile(snapshot.files, previous) : null;
    if (next) await showFile(next, true);
    else set({ changesFile: null });
    return { trees, snapshot };
  };

  const addedWorktree = (trees: Worktree[], before: readonly string[]) => {
    const platform = get().platform;
    return (
      trees.find(
        (t) =>
          !t.unavailable && !before.some((p) => samePath(p, t.path, platform)),
      ) ?? null
    );
  };

  return {
    refreshWorktree,

    async execute(action, label) {
      const state = get();
      const worktree = state.activePath;
      if (!worktree || state.mutation) return;
      const previous = state.changesFile?.file ?? null;
      const before =
        projectOf(state.projects, worktree)?.worktrees.map((t) => t.path) ?? [];
      set({ mutation: label, error: null, notice: null });
      let ok = false;
      try {
        await bridge.runAction(worktree, action);
        ok = true;
        succeeded(action, worktree);
      } catch (error) {
        failed(action, label, error);
      }
      try {
        const result = await refreshWorktree(worktree, previous);
        if (!KEEPS_HISTORY.has(action.type))
          set({ commit: null, historyFile: null });
        set({ mutation: null });
        const added =
          ok && action.type === "addWorktree" && result
            ? addedWorktree(result.trees, before)
            : null;
        if (added) selectWorktree(added.path);
      } catch (error) {
        const detail = errorMessage(error);
        const message = ok
          ? `${label} succeeded, but reading the worktree again failed. ${detail}`
          : `${get().error ?? `${label} failed.`} Reading the worktree again also failed: ${detail}`;
        set({ mutation: null, error: message });
      }
    },
  };
}
