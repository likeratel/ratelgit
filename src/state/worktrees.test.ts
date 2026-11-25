import type { RemoveOptions } from "../bridge";
import { describe, expect, it, vi } from "vitest";
import { createFakeBridge } from "../bridge/fake/fakeBridge";
import { WEB, WEB_DARK, WEB_LOGIN } from "../bridge/fake/world";
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

const trees = (store: AppStore) =>
  store.getState().projects[0].worktrees.map((t) => t.path);

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

describe("worktrees", () => {
  it("adds a worktree on a new branch and switches to it", async () => {
    const { fake, store } = await started();
    store.getState().openNewWorktree(null);
    expect(store.getState().newWorktree).toEqual({ reference: null });
    const plan = await store
      .getState()
      .planWorktree(null, "ratel-web-next", "next");
    expect(plan).toEqual({
      path: "/work/ratel-web-next",
      folderError: null,
      branchError: null,
    });
    const taken = await store
      .getState()
      .planWorktree(null, "ratel-web-dark", "main");
    expect(taken?.folderError).toMatch(/already exists/);
    expect(taken?.branchError).toMatch(/already exists/);

    await store
      .getState()
      .addWorktree(
        { type: "new", name: "next", startPoint: "refs/remotes/origin/main" },
        "ratel-web-next",
      );
    await idle(store);
    expect(store.getState().newWorktree).toBeNull();
    expect(trees(store)).toContain("/work/ratel-web-next");
    expect(store.getState().activePath).toBe("/work/ratel-web-next");
    expect(fake.controls.actions().at(-1)).toEqual({
      type: "addWorktree",
      branch: {
        type: "new",
        name: "next",
        startPoint: "refs/remotes/origin/main",
      },
      parent: null,
      folder: "ratel-web-next",
    });
  });

  it("removes the selected worktree, its branch, draft and filter entry", async () => {
    const { store } = await started();
    store.getState().selectWorktree(WEB_DARK);
    await idle(store);
    store.getState().setDraft("Dark draft");
    store.getState().toggleFilter(["refs/heads/feature/ui/dark-mode"]);
    await idle(store);
    const tree = store
      .getState()
      .projects[0].worktrees.find((t) => t.path === WEB_DARK)!;
    await store.getState().openRemoveWorktree(tree);
    expect(store.getState().removal?.preview?.branch).toBe(
      "feature/ui/dark-mode",
    );
    await store.getState().removeWorktree(
      agreed(store, {
        force: true,
        deleteBranch: true,
        allowUnmerged: false,
        deleteRemote: false,
      }),
    );
    await idle(store);
    expect(store.getState().removal).toBeNull();
    expect(trees(store)).not.toContain(WEB_DARK);
    expect(store.getState().activePath).toBe(WEB);
    expect(store.getState().drafts[WEB_DARK]).toBeUndefined();
    expect(store.getState().filters[WEB]).not.toContain(
      "refs/heads/feature/ui/dark-mode",
    );
    expect(
      store
        .getState()
        .references.some((r) => r.id === "refs/heads/feature/ui/dark-mode"),
    ).toBe(false);
    expect(store.getState().error).toBeNull();
  });

  it("reports a partial failure exactly", async () => {
    const { fake, store } = await started();
    fake.controls.setOffline(true);
    const tree = store
      .getState()
      .projects[0].worktrees.find((t) => t.path === WEB_DARK)!;
    await store.getState().openRemoveWorktree(tree);
    await store.getState().removeWorktree(
      agreed(store, {
        force: true,
        deleteBranch: true,
        allowUnmerged: false,
        deleteRemote: true,
      }),
    );
    await idle(store);
    expect(trees(store)).not.toContain(WEB_DARK);
    expect(store.getState().error).toMatch(
      /worktree and the local branch were removed, but deleting the remote branch origin\/feature\/ui\/dark-mode failed/,
    );
  });

  it("keeps everything when the removal is refused", async () => {
    const { fake, store } = await started();
    const tree = store
      .getState()
      .projects[0].worktrees.find((t) => t.path === WEB_LOGIN)!;
    await store.getState().openRemoveWorktree(tree);
    await store.getState().removeWorktree(
      agreed(store, {
        force: false,
        deleteBranch: true,
        allowUnmerged: false,
        deleteRemote: false,
      }),
    );
    await idle(store);
    expect(store.getState().error).toMatch(/^Remove Worktree failed\./);
    expect(trees(store)).toContain(WEB_LOGIN);
    expect(
      fake.controls.calls().some((c) => c.command === "removeWorktree"),
    ).toBe(true);
  });
});
