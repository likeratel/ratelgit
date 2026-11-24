import { describe, expect, it, vi } from "vitest";
import { BridgeError, type Bridge } from "../bridge";
import { createFakeBridge } from "../bridge/fake/fakeBridge";
import { WEB, WEB_LOGIN } from "../bridge/fake/world";
import { refreshOnFocus } from "../shell/useFocusRefresh";
import { createAppStore, type AppStore } from "./store";

const idle = (store: AppStore) =>
  vi.waitFor(() => {
    const s = store.getState();
    expect(
      s.loading || s.mutation !== null || s.changesFile?.loading === true,
    ).toBe(false);
  });

async function started(
  adjust: (fake: ReturnType<typeof createFakeBridge>) => Bridge = (b) => b,
) {
  const fake = createFakeBridge();
  const store = createAppStore(adjust(fake));
  await store.getState().init();
  await idle(store);
  return { fake, store };
}

describe("re-review", () => {
  it("clears the page flag when a quiet refresh replaces the listing mid-page", async () => {
    let changed = false;
    const { fake, store } = await started((fake) => ({
      ...fake,
      async loadWorktree(worktree, filter) {
        const snapshot = await fake.loadWorktree(worktree, filter);
        if (!changed) return snapshot;
        const [first, ...rest] = snapshot.history.lines;
        const added = {
          ...first,
          hash: "f".repeat(40),
          subject: "External commit",
        };
        return {
          ...snapshot,
          history: { ...snapshot.history, lines: [added, first, ...rest] },
        };
      },
      async loadHistory(worktree, filter, skip) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return fake.loadHistory(worktree, filter, skip);
      },
    }));
    store.setState({
      history: { ...store.getState().history, complete: false },
    });
    const page = store.getState().loadMoreHistory();
    changed = true;
    await store.getState().refreshQuietly();
    await page;
    expect(store.getState().loadingPage).toBe(false);
    expect(store.getState().history.lines[0].subject).toBe("External commit");
    expect(fake.controls.calls().length).toBeGreaterThan(0);
  });

  it("keeps a chunk chosen while a quiet refresh re-reads the conflict", async () => {
    const { fake, store } = await started();
    store.getState().selectWorktree(WEB_LOGIN);
    await idle(store);
    store.setState({ mode: "changes" });
    await store
      .getState()
      .selectFile(store.getState().files.find((f) => f.status === "U")!);
    fake.controls.setLatency((call) =>
      call.command === "loadConflict" ? 80 : 0,
    );
    const refresh = store.getState().refreshQuietly();
    await new Promise((resolve) => setTimeout(resolve, 20));
    store.getState().chooseChunk(0, "theirs");
    await refresh;
    expect(store.getState().changesFile?.choices[0]).toBe("theirs");
  });

  it("keeps the action's error when the reselected diff also fails", async () => {
    const { fake, store } = await started();
    store.setState({ mode: "changes" });
    const file = store
      .getState()
      .files.find((f) => f.path === "src/session.ts")!;
    await store.getState().selectFile(file);
    fake.controls.failNext("runAction", "git_failed", "index.lock exists");
    fake.controls.failNext("loadDiff", "git_failed", "diff broke");
    await store.getState().execute({ type: "stage", file }, "Stage");
    await idle(store);
    expect(store.getState().error).toBe("Stage failed. index.lock exists");
  });

  it("shows missing partial-clone content in the diff area, not the error bar", async () => {
    const { store } = await started((fake) => ({
      ...fake,
      loadDiff: async () => {
        throw new BridgeError(
          "missing_objects",
          "The content of this file has not been downloaded yet.",
        );
      },
    }));
    const commit = store.getState().history.lines[3].hash;
    await store.getState().selectCommit(commit);
    await vi.waitFor(() =>
      expect(store.getState().historyFile?.loading).toBe(false),
    );
    expect(store.getState().error).toBeNull();
    expect(store.getState().historyFile?.unavailable).toMatch(
      /not been downloaded/,
    );
  });

  it("replaces the history when the new first page is empty", async () => {
    const { store } = await started((fake) => ({
      ...fake,
      async loadWorktree(worktree, filter) {
        const snapshot = await fake.loadWorktree(worktree, filter);
        return worktree === WEB && filter === null && emptied
          ? { ...snapshot, history: { lines: [], complete: true } }
          : snapshot;
      },
    }));
    emptied = true;
    await store.getState().refreshQuietly();
    expect(store.getState().history.lines).toEqual([]);
  });

  it("re-reads only the active project when the window gets focus", async () => {
    const { fake, store } = await started();
    const before = fake.controls
      .calls()
      .filter((c) => c.command === "listProjects").length;
    await refreshOnFocus(store.getState());
    expect(
      fake.controls.calls().filter((c) => c.command === "listProjects").length,
    ).toBe(before);
    expect(fake.controls.calls().at(-1)?.command).toMatch(
      /listWorktrees|loadWorktree|loadDiff/,
    );
  });
});

let emptied = false;
