import {
  errorKind,
  type Bridge,
  type ChangedFile,
  type Reference,
  type RemoveOptions,
  type Worktree,
  type WorktreeBranch,
} from "../bridge";
import { describe, projectOf } from "./helpers";
import type { GetState, Operations, ProjectView, SetState } from "./types";

type WorktreeOps = Pick<
  Operations,
  | "openNewWorktree"
  | "closeNewWorktree"
  | "planWorktree"
  | "addWorktree"
  | "openRemoveWorktree"
  | "closeRemoveWorktree"
  | "removeWorktree"
>;

interface Deps {
  execute: Operations["execute"];
  selectWorktree: (path: string) => void;
  refreshWorktree: (
    worktree: string,
    previous: ChangedFile | null,
  ) => Promise<unknown>;
  persist: () => void;
}

const LABEL = "Remove Worktree";

/**
 * A usable worktree of the project that contains `path`, other than `except`: the selected
 * one if it belongs there, else the first available one. The main entry can be a bare
 * repository, which is listed but not usable, so it is not assumed to work.
 */
function anchorOf(
  projects: readonly ProjectView[],
  path: string,
  active: string | null,
  except: string | null = null,
): string | null {
  const trees = (projectOf(projects, path)?.worktrees ?? []).filter(
    (t) => !t.unavailable && t.path !== except,
  );
  return (trees.find((t) => t.path === active) ?? trees[0])?.path ?? null;
}

export function worktreeOperations(
  set: SetState,
  get: GetState,
  bridge: Bridge,
  deps: Deps,
): WorktreeOps {
  /** Forgets what belonged to a removed worktree: its draft, and a deleted branch in the
   * filter of the project it belonged to (which need not be the selected one). */
  const forget = (
    project: string | null,
    target: string,
    deletedBranch: string | null,
  ) => {
    const state = get();
    const drafts = Object.fromEntries(
      Object.entries(state.drafts).filter(([path]) => path !== target),
    );
    const filter = project ? state.filters[project] : undefined;
    const ref = deletedBranch ? `refs/heads/${deletedBranch}` : null;
    if (project && filter && ref && filter.includes(ref)) {
      set({
        drafts,
        filters: {
          ...state.filters,
          [project]: filter.filter((r) => r !== ref),
        },
      });
      deps.persist();
    } else {
      set({ drafts });
    }
  };

  /** Re-reads the project's worktrees and the selected worktree; failures are reported, not thrown. */
  const refreshAfterRemoval = async (target: string, anchor: string | null) => {
    try {
      if (anchor) {
        const trees = await bridge.listWorktrees(anchor);
        set({
          projects: get().projects.map((p) =>
            p.worktrees.some((t) => t.path === anchor)
              ? { ...p, worktrees: trees }
              : p,
          ),
        });
      }
    } catch (error) {
      set({
        error: get().error ?? describe("Reading the worktrees again", error),
      });
    }
    const active = get().activePath;
    if (active === target) {
      if (anchor) deps.selectWorktree(anchor);
      return;
    }
    try {
      if (active)
        await deps.refreshWorktree(active, get().changesFile?.file ?? null);
    } catch (error) {
      set({
        error: get().error ?? describe("Reading the worktree again", error),
      });
    }
  };

  /** Reads the preview again into a new round of the dialog. */
  const reopen = async (tree: Worktree, round: number) => {
    const worktree = anchorOf(get().projects, tree.path, get().activePath);
    if (!worktree) return;
    set({ removal: { tree, preview: null, round: round + 1 } });
    try {
      const preview = await bridge.worktreeRemoval(worktree, tree.path);
      set({ removal: { tree, preview, round: round + 1 } });
    } catch (error) {
      set({ removal: null, error: describe("Checking the worktree", error) });
    }
  };

  return {
    openNewWorktree(reference: Reference | null) {
      if (get().mutation || !get().activePath) return;
      set({ newWorktree: { reference }, worktreeParent: null });
    },

    closeNewWorktree: () => set({ newWorktree: null }),

    async planWorktree(parent, folder, newBranch) {
      const worktree = get().activePath;
      if (!worktree) return null;
      try {
        return await bridge.planWorktree(worktree, parent, folder, newBranch);
      } catch {
        // Checking as you type is only a help; the core checks again when adding.
        return null;
      }
    },

    async addWorktree(branch: WorktreeBranch, folder: string) {
      // While another action runs nothing can start, so the dialog and its input stay.
      if (get().mutation || !get().activePath) return;
      const parent = get().worktreeParent?.token ?? null;
      set({ newWorktree: null });
      await deps.execute(
        { type: "addWorktree", branch, parent, folder: folder.trim() },
        "Add Worktree",
      );
    },

    async openRemoveWorktree(tree) {
      const state = get();
      const worktree = anchorOf(state.projects, tree.path, state.activePath);
      if (!worktree || state.mutation) return;
      const round = (state.removal?.round ?? 0) + 1;
      set({ removal: { tree, preview: null, round } });
      try {
        const preview = await bridge.worktreeRemoval(worktree, tree.path);
        if (get().removal?.tree.path === tree.path)
          set({ removal: { tree, preview, round } });
      } catch (error) {
        set({ removal: null, error: describe("Checking the worktree", error) });
      }
    },

    closeRemoveWorktree: () => set({ removal: null }),

    async removeWorktree(options: RemoveOptions) {
      const state = get();
      const removal = state.removal;
      if (!removal || state.mutation) return;
      const target = removal.tree.path;
      const project = projectOf(state.projects, target)?.path ?? null;
      const anchor = anchorOf(state.projects, target, state.activePath, target);
      const via = anchor ?? anchorOf(state.projects, target, state.activePath);
      if (!via) return;
      set({ removal: null, mutation: LABEL, error: null, notice: null });
      try {
        const result = await bridge.removeWorktree(via, target, options);
        forget(
          project,
          target,
          result.branchDeleted ? (removal.preview?.branch ?? null) : null,
        );
        // Later steps can fail after the worktree is gone; say exactly what did not happen.
        if (result.problem) set({ error: result.problem });
      } catch (error) {
        if (errorKind(error) === "stale") {
          // More would be lost than the dialog showed: show it again with the new numbers.
          set({
            mutation: null,
            notice:
              "The worktree changed since it was checked. Review what would be lost and confirm again.",
          });
          await reopen(removal.tree, removal.round);
          return;
        }
        set({ mutation: null, error: describe(LABEL, error) });
        await refreshAfterRemoval("", anchor ?? via);
        return;
      }
      set({ mutation: null });
      await refreshAfterRemoval(target, anchor);
    },
  };
}
