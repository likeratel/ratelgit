import type { Bridge, WorktreeSnapshot } from "../bridge";
import { describe, filterSetting } from "./helpers";
import { followFile } from "./mutations";
import type { Tokens } from "./tokens";
import type { GetState, HistoryState, SetState } from "./types";

/** Keeps the loaded pages when the first page did not change, so scrolling stays put. */
function mergeHistory(
  current: HistoryState,
  snapshot: WorktreeSnapshot,
  token: number,
): HistoryState {
  const fresh = snapshot.history.lines;
  const same =
    fresh.length > 0 &&
    current.lines.length >= fresh.length &&
    fresh.every((line, index) => {
      const old = current.lines[index];
      return old.hash === line.hash && old.refs.join() === line.refs.join();
    });
  if (same) return { ...current, headHidden: snapshot.headHidden };
  return {
    lines: fresh,
    complete: snapshot.history.complete,
    headHidden: snapshot.headHidden,
    token,
  };
}

/**
 * Re-reads the selected worktree when the window comes back, without blanking anything:
 * selection, drafts and pages already loaded stay, and the selected file's diff is replaced
 * once the new one is there. Skipped while an action runs.
 */
export function createQuietRefresh(
  set: SetState,
  get: GetState,
  bridge: Bridge,
  tokens: Tokens,
  showFile: (
    file: Parameters<typeof followFile>[1],
    quiet?: boolean,
  ) => Promise<void>,
) {
  return async () => {
    const state = get();
    const path = state.activePath;
    if (!path || state.mutation || state.loading) return;
    const token = tokens.next("workspace");
    try {
      const [trees, snapshot] = await Promise.all([
        bridge.listWorktrees(path),
        bridge.loadWorktree(path, filterSetting(state)),
      ]);
      const now = get();
      if (
        !tokens.current("workspace", token) ||
        now.activePath !== path ||
        now.mutation
      )
        return;
      set({
        projects: now.projects.map((p) =>
          p.worktrees.some((t) => t.path === path)
            ? { ...p, worktrees: trees }
            : p,
        ),
        references: snapshot.references,
        defaultFilter: snapshot.defaultFilter,
        files: snapshot.files,
        tracking: snapshot.tracking,
        operation: snapshot.operation,
        history: mergeHistory(now.history, snapshot, token),
      });
      const view = get().changesFile;
      if (!view) return;
      const next = followFile(snapshot.files, view.file);
      if (next) await showFile(next, true);
      else set({ changesFile: null });
    } catch (error) {
      if (tokens.current("workspace", token))
        set({ error: describe("Refreshing", error) });
    }
  };
}
