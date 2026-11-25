import type { RemoveOptions } from "../bridge";
import { describe, expect, it, vi } from "vitest";
import { createFakeBridge } from "../bridge/fake/fakeBridge";
import { API, WEB, WEB_DARK } from "../bridge/fake/world";
import { createAppStore, type AppStore } from "./store";

const idle = (store: AppStore) =>
  vi.waitFor(() => {
    const s = store.getState();
    expect(s.loading || s.mutation !== null).toBe(false);
  });

async function started() {
  const fake = createFakeBridge();
  const store = createAppStore(fake);
  await store.getState().init();
  await idle(store);
  return { fake, store };
}

const tree = (store: AppStore, path: string) =>
  store
    .getState()
    .projects.flatMap((p) => p.worktrees)
    .find((t) => t.path === path)!;

/** Options agreeing to exactly what the open removal dialog shows. */
function agreed(
  store: AppStore,
  flags: Omit<RemoveOptions, "seen">,
): RemoveOptions {
  const preview = store.getState().removal!.preview!;
  const lostCommits = flags.deleteBranch
    ? flags.deleteRemote
      ? preview.unmergedWithRemote
      : preview.unmergedCommits
    : preview.branch === null
      ? preview.unmergedCommits
      : 0;
  return {
    ...flags,
    seen: {
      changes: preview.changes,
      untracked: preview.untracked,
      ignored: preview.ignored,
      lostCommits,
      locked: preview.locked !== null,
      operation: preview.operation !== null,
      submodules: preview.submodules,
      tip: preview.tip,
    },
  };
}

describe("worktree removal safety in the store", () => {
  it("asks through a usable worktree when the main folder is a bare repository", async () => {
    const { fake, store } = await started();
    // A bare main "worktree" is listed but unavailable.
    store.setState({
      projects: store.getState().projects.map((p) =>
        p.path === WEB
          ? {
              ...p,
              worktrees: p.worktrees.map((t) =>
                t.isMain ? { ...t, unavailable: true } : t,
              ),
            }
          : p,
      ),
    });
    await store.getState().openRemoveWorktree(tree(store, WEB_DARK));
    const asked = fake.controls
      .calls()
      .filter((c) => c.command === "worktreeRemoval")
      .at(-1);
    expect(asked?.args[0]).not.toBe(WEB);
    expect(store.getState().removal?.preview).not.toBeNull();
  });

  it("does not leave a rejected promise when refreshing after a removal fails", async () => {
    const { fake, store } = await started();
    await store.getState().openRemoveWorktree(tree(store, WEB_DARK));
    fake.controls.failNext("loadWorktree", "git_failed", "index.lock exists");
    await store.getState().removeWorktree(
      agreed(store, {
        force: true,
        deleteBranch: false,
        allowUnmerged: false,
        deleteRemote: false,
      }),
    );
    await idle(store);
    expect(store.getState().error).toMatch(/index\.lock exists/);
    expect(store.getState().error).not.toMatch(/^Remove Worktree failed/);
  });

  it("cleans the filter of the project the removed worktree belonged to", async () => {
    const { store } = await started();
    store.getState().selectWorktree(API);
    await idle(store);
    await store
      .getState()
      .addWorktree(
        { type: "new", name: "spike", startPoint: "HEAD" },
        "api-spike",
      );
    await idle(store);
    store.getState().selectWorktree(API);
    await idle(store);
    store.getState().toggleFilter(["refs/heads/spike"]);
    await idle(store);
    expect(store.getState().filters[API]).toContain("refs/heads/spike");
    store.getState().selectWorktree(WEB);
    await idle(store);
    await store.getState().openRemoveWorktree(tree(store, "/work/api-spike"));
    await store.getState().removeWorktree(
      agreed(store, {
        force: false,
        deleteBranch: true,
        allowUnmerged: false,
        deleteRemote: false,
      }),
    );
    await idle(store);
    expect(store.getState().filters[API]).not.toContain("refs/heads/spike");
  });

  it("keeps the new-worktree dialog open while another action runs", async () => {
    const { fake, store } = await started();
    store.getState().openNewWorktree(null);
    store.setState({ mutation: "Fetch" });
    await store
      .getState()
      .addWorktree(
        { type: "new", name: "later", startPoint: "HEAD" },
        "ratel-web-later",
      );
    expect(store.getState().newWorktree).not.toBeNull();
    expect(fake.controls.actions()).toEqual([]);
  });
});

describe("a removal refused as out of date", () => {
  it("shows the dialog again with the new preview and a fresh consent", async () => {
    const { fake, store } = await started();
    await store.getState().openRemoveWorktree(tree(store, WEB_DARK));
    const first = store.getState().removal!;
    expect(first.preview?.changes).toBe(1);
    // A consent given for a cleaner state than the worktree is in now.
    await store.getState().removeWorktree({
      force: true,
      deleteBranch: true,
      allowUnmerged: true,
      deleteRemote: false,
      seen: {
        ...{ changes: 0, untracked: 0, ignored: 0, lostCommits: 0 },
        locked: false,
        operation: false,
        submodules: false,
        tip: null,
      },
    });
    await idle(store);
    const again = store.getState().removal!;
    expect(again).not.toBeNull();
    expect(again.preview?.changes).toBe(1);
    expect(again.round).toBeGreaterThan(first.round);
    expect(store.getState().notice).toMatch(/changed since it was checked/);
    expect(tree(store, WEB_DARK)).toBeDefined();
    expect(
      fake.controls.calls().filter((c) => c.command === "worktreeRemoval")
        .length,
    ).toBe(2);
  });
});
