import { createStore, type StoreApi } from "zustand/vanilla";
import type { Bridge } from "../bridge";
import { promptAction } from "./dialogs";
import { describe, EMPTY_HISTORY } from "./helpers";
import { mutationOperations } from "./mutations";
import { createQuietRefresh } from "./refresh";
import { projectOperations } from "./projects";
import { selectionOperations } from "./selection";
import { createTokens } from "./tokens";
import type { AppState, Data } from "./types";
import { createReload, workspaceOperations } from "./workspace";

/** Delay before preferences are written, so dragging a divider saves once. */
export const SAVE_DELAY_MS = 400;

export function initialData(bridge: Bridge): Data {
  return {
    bridge,
    ready: false,
    platform: "macos",
    projects: [],
    projectPath: null,
    activePath: null,
    references: [],
    history: EMPTY_HISTORY,
    files: [],
    tracking: null,
    operation: null,
    loading: false,
    loadingPage: false,
    mutation: null,
    error: null,
    notice: null,
    filters: {},
    drafts: {},
    mode: "history",
    commit: null,
    historyFile: null,
    changesFile: null,
    ui: {
      diffLayout: "unified",
      ignoreWhitespace: false,
      sidebarWidth: 272,
      historySplit: 0.55,
      changesSplit: 0.42,
      lastWorktree: null,
    },
    confirmation: null,
    prompt: null,
    switcherOpen: false,
    worktreeParent: null,
  };
}

export type AppStore = StoreApi<AppState>;

export function createAppStore(bridge: Bridge): AppStore {
  return createStore<AppState>()((set, get) => {
    const tokens = createTokens();
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const persist = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        const { filters, ui } = get();
        // A bridge may also throw before it returns a promise; both end up here.
        Promise.resolve()
          .then(() => bridge.savePreferences(filters, ui))
          .catch((error: unknown) => {
            set({ error: describe("Saving settings", error) });
          });
      }, SAVE_DELAY_MS);
    };
    const reload = createReload(set, get, bridge, tokens);
    const projects = projectOperations(
      set,
      get,
      bridge,
      tokens,
      reload,
      persist,
    );
    const selection = selectionOperations(set, get, bridge, tokens);
    const workspace = workspaceOperations(
      set,
      get,
      bridge,
      tokens,
      reload,
      persist,
    );
    const mutations = mutationOperations(
      set,
      get,
      bridge,
      tokens,
      selection.showFile,
      projects.selectWorktree,
      persist,
    );
    const refreshQuietly = createQuietRefresh(
      set,
      get,
      bridge,
      tokens,
      selection.showFile,
    );
    return {
      ...initialData(bridge),
      ...projects,
      ...workspace,
      ...selection,
      ...mutations,
      refreshQuietly,
      setDraft(text) {
        const path = get().activePath;
        if (path) set({ drafts: { ...get().drafts, [path]: text } });
      },
      confirm: (confirmation) => set({ confirmation }),
      runConfirmation() {
        const current = get().confirmation;
        set({ confirmation: null });
        if (current) void mutations.execute(current.action, current.label);
      },
      dismissConfirmation: () => set({ confirmation: null }),
      ask: (prompt) => set({ prompt, worktreeParent: null }),
      async chooseWorktreeParent() {
        try {
          const chosen = await bridge.chooseWorktreeParent();
          if (chosen) set({ worktreeParent: chosen });
        } catch (error) {
          set({ error: describe("Choosing the folder", error) });
        }
      },
      dismissNotice: () => set({ notice: null }),
      submitPrompt(text) {
        const current = get().prompt;
        set({ prompt: null });
        const parent = get().worktreeParent?.token ?? null;
        const next = current ? promptAction(current, text, parent) : null;
        if (next) void mutations.execute(next[0], next[1]);
      },
      dismissPrompt: () => set({ prompt: null }),
      dismissError: () => set({ error: null }),
      setSwitcherOpen: (switcherOpen) => set({ switcherOpen }),
      updateUi(change) {
        const before = get().ui;
        set({ ui: { ...before, ...change } });
        persist();
        if (
          change.ignoreWhitespace !== undefined &&
          change.ignoreWhitespace !== before.ignoreWhitespace
        ) {
          const { historyFile, changesFile } = get();
          [historyFile, changesFile].forEach((view) => {
            if (view && view.file.status !== "U")
              void selection.selectFile(view.file);
          });
        }
      },
      async openFile(path) {
        const worktree = get().activePath;
        if (!worktree) return;
        try {
          const result = await bridge.openFile(worktree, path);
          if (result.action === "revealed") {
            set({
              notice: `${path} could run a program when opened, so it is shown in the file manager instead.`,
            });
          }
        } catch (error) {
          set({ error: describe("Opening the file", error) });
        }
      },
    };
  });
}
