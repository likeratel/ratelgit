import { MAX_FILTER_REFS, type Bridge, type WorktreeSnapshot } from "../bridge";
import {
  removeRef,
  sameFilter,
  toggleCurrentBranch,
  toggleRefs,
} from "../lib/historyFilter";
import {
  activeFilter,
  describe,
  EMPTY_HISTORY,
  filterSetting,
} from "./helpers";
import type { Tokens } from "./tokens";
import type { GetState, Operations, SetState } from "./types";

type WorkspaceOps = Pick<
  Operations,
  | "setMode"
  | "loadMoreHistory"
  | "toggleFilter"
  | "removeFromFilter"
  | "clearFilter"
  | "resetFilter"
  | "toggleCurrentBranchOnly"
  | "filterTo"
>;

/** Applies a snapshot to the store, recording a pruned filter for its project. */
export function applySnapshot(
  set: SetState,
  get: GetState,
  snapshot: WorktreeSnapshot,
  token: number,
) {
  const { projectPath, filters } = get();
  // A chosen filter loses refs that no longer exist; the default filter is not stored.
  const chosen = projectPath ? filters[projectPath] : undefined;
  const filterChanged =
    projectPath !== null &&
    chosen !== undefined &&
    !sameFilter(chosen, snapshot.filter);
  set({
    references: snapshot.references,
    defaultFilter: snapshot.defaultFilter,
    history: {
      lines: snapshot.history.lines,
      complete: snapshot.history.complete,
      headHidden: snapshot.headHidden,
      token,
    },
    files: snapshot.files,
    tracking: snapshot.tracking,
    operation: snapshot.operation,
    loading: false,
    loadingPage: false,
    ...(filterChanged && projectPath
      ? { filters: { ...filters, [projectPath]: snapshot.filter } }
      : {}),
  });
}

/** Reads the selected worktree again. Only the latest request reaches the screen. */
export function createReload(
  set: SetState,
  get: GetState,
  bridge: Bridge,
  tokens: Tokens,
) {
  return async () => {
    const path = get().activePath;
    if (!path) return;
    const token = tokens.next("workspace");
    // An earlier error stays until the user dismisses it or starts another action.
    set({ loading: true });
    try {
      const snapshot = await bridge.loadWorktree(path, filterSetting(get()));
      if (!tokens.current("workspace", token) || get().activePath !== path)
        return;
      applySnapshot(set, get, snapshot, token);
    } catch (error) {
      if (!tokens.current("workspace", token)) return;
      set({ loading: false, error: describe("Reading the worktree", error) });
    }
  };
}

export function workspaceOperations(
  set: SetState,
  get: GetState,
  bridge: Bridge,
  tokens: Tokens,
  reload: () => Promise<void>,
  persist: () => void,
): WorkspaceOps {
  /** `null` returns to the default filter. */
  const setFilter = (next: string[] | null) => {
    const state = get();
    const project = state.projectPath;
    if (!project || !state.activePath || state.mutation) return;
    const current = filterSetting(state);
    const unchanged =
      next === null || current === null
        ? next === current
        : sameFilter(current, next);
    if (unchanged) return;
    if (next !== null && next.length > MAX_FILTER_REFS) {
      set({
        error: `History can be filtered to at most ${MAX_FILTER_REFS} branches and tags. Remove some from the filter first.`,
      });
      return;
    }
    tokens.next("history");
    const filters =
      next === null
        ? Object.fromEntries(
            Object.entries(state.filters).filter(([key]) => key !== project),
          )
        : { ...state.filters, [project]: next };
    set({
      filters,
      history: EMPTY_HISTORY,
      commit: null,
      historyFile: null,
    });
    persist();
    void reload();
  };

  return {
    setMode(mode) {
      if (get().mode !== mode) set({ mode });
    },

    async loadMoreHistory() {
      const state = get();
      const path = state.activePath;
      if (!path || state.history.complete || state.loadingPage || state.loading)
        return;
      const listing = state.history.token;
      const token = tokens.next("page");
      set({ loadingPage: true });
      try {
        const page = await bridge.loadHistory(
          path,
          filterSetting(state),
          state.history.lines.length,
        );
        const now = get();
        if (!tokens.current("page", token)) return;
        // A newer listing replaced this one while the page was loading.
        if (now.history.token !== listing) {
          set({ loadingPage: false });
          return;
        }
        // Refs can move between pages; a commit already listed is not listed twice.
        const seen = new Set(now.history.lines.map((line) => line.hash));
        const fresh = page.lines.filter((line) => !seen.has(line.hash));
        set({
          loadingPage: false,
          history: {
            ...now.history,
            lines: [...now.history.lines, ...fresh],
            complete: page.complete,
          },
        });
      } catch (error) {
        if (!tokens.current("page", token)) return;
        set({
          loadingPage: false,
          error: describe("Loading more history", error),
        });
      }
    },

    toggleFilter: (ids) => setFilter(toggleRefs(activeFilter(get()), ids)),
    removeFromFilter: (id) => setFilter(removeRef(activeFilter(get()), id)),
    clearFilter: () => setFilter([]),
    resetFilter: () => setFilter(null),
    toggleCurrentBranchOnly: () =>
      setFilter(toggleCurrentBranch(activeFilter(get()))),
    filterTo(id) {
      set({ mode: "history" });
      setFilter([id]);
    },
  };
}
