import { useEffect } from "react";
import { useAppStore } from "../state/context";
import type { AppState } from "../state/types";

/** Wait after focus returns, so quickly switching apps does not refresh each time. */
const DELAY_MS = 600;
/** At most one refresh in this period. */
const MIN_INTERVAL_MS = 3000;

/** Only the selected worktree and its project's worktrees: cheap enough for every focus.
 * Re-reading every project is left to Refresh. */
export function refreshOnFocus(state: AppState): Promise<void> {
  return state.refreshQuietly();
}

/**
 * When the window gets focus back, re-reads the selected worktree and its project's sidebar counts.
 * Changes made in a terminal or editor show up without pressing Refresh. Skipped while an
 * action or a dialog is open; selection, drafts and loaded pages are kept.
 */
export function useFocusRefresh() {
  const store = useAppStore();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = 0;
    const onFocus = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const state = store.getState();
        const busy =
          state.mutation !== null ||
          state.prompt !== null ||
          state.confirmation !== null;
        if (busy || Date.now() - last < MIN_INTERVAL_MS) return;
        last = Date.now();
        void refreshOnFocus(state);
      }, DELAY_MS);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timer) clearTimeout(timer);
    };
  }, [store]);
}
