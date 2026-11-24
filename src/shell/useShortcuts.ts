import { useEffect } from "react";
import { findShortcut, isMac, type ShortcutName } from "../lib/shortcuts";
import { useAppStore } from "../state/context";
import type { AppState } from "../state/types";

const ACTIONS: Record<ShortcutName, (state: AppState) => void> = {
  history: (s) => s.setMode("history"),
  changes: (s) => s.setMode("changes"),
  quickOpen: (s) => s.setSwitcherOpen(!s.switcherOpen),
  currentBranchOnly: (s) => s.toggleCurrentBranchOnly(),
  refresh: (s) => s.refresh(),
  openRepository: (s) => void s.addProject(),
  previousWorktree: (s) => s.moveWorktree(-1),
  nextWorktree: (s) => s.moveWorktree(1),
};

/** Only the quick switcher toggle works while a dialog is open. */
const DURING_DIALOG = new Set<ShortcutName>(["quickOpen"]);

/** App-wide shortcuts, matched on the physical key so they work with any input method. */
export function useShortcuts() {
  const store = useAppStore();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const state = store.getState();
      const name = findShortcut(event, isMac(state.platform));
      if (!name) return;
      // Keep the web view from reloading or printing; these keys belong to the app.
      event.preventDefault();
      const dialogOpen = state.confirmation !== null || state.prompt !== null;
      if (dialogOpen && !DURING_DIALOG.has(name)) return;
      if (state.switcherOpen && name !== "quickOpen") return;
      ACTIONS[name](state);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [store]);
}
