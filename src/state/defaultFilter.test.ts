import { describe, expect, it, vi } from "vitest";
import { createFakeBridge } from "../bridge/fake/fakeBridge";
import { WEB, WEB_DARK } from "../bridge/fake/world";
import { activeFilter, isDefaultFilter } from "./helpers";
import { createAppStore, type AppStore } from "./store";

const MAIN = "refs/remotes/origin/main";

const idle = (store: AppStore) =>
  vi.waitFor(() => expect(store.getState().loading).toBe(false));

async function started() {
  const fake = createFakeBridge();
  const store = createAppStore(fake);
  await store.getState().init();
  await idle(store);
  return { fake, store };
}

const subjects = (store: AppStore) =>
  store.getState().history.lines.map((l) => l.subject);
const lastFilterSent = (fake: ReturnType<typeof createFakeBridge>) =>
  fake.controls
    .calls()
    .filter((c) => c.command === "loadWorktree")
    .at(-1)?.args[1];

describe("default history filter", () => {
  it("starts on the current branch plus origin/main", async () => {
    const { fake, store } = await started();
    expect(isDefaultFilter(store.getState())).toBe(true);
    expect(lastFilterSent(fake)).toBeNull();
    expect(activeFilter(store.getState())).toEqual(["HEAD", MAIN]);
    expect(subjects(store)).toContain("Document local setup");
    expect(subjects(store)).not.toContain("Add a dark colour scheme");
  });

  it("shows every branch, then goes back to the default", async () => {
    const { fake, store } = await started();
    store.getState().clearFilter();
    await idle(store);
    expect(store.getState().filters[WEB]).toEqual([]);
    expect(lastFilterSent(fake)).toEqual([]);
    expect(subjects(store)).toContain("Add a dark colour scheme");
    expect(isDefaultFilter(store.getState())).toBe(false);

    store.getState().resetFilter();
    await idle(store);
    expect(WEB in store.getState().filters).toBe(false);
    expect(lastFilterSent(fake)).toBeNull();
    expect(isDefaultFilter(store.getState())).toBe(true);
    expect(subjects(store)).not.toContain("Add a dark colour scheme");
    await vi.waitFor(() => {
      const saved = fake.controls
        .calls()
        .filter((c) => c.command === "savePreferences")
        .at(-1);
      expect(saved?.args[0]).toEqual({});
    });
  });

  it("turns into a custom filter when a branch is toggled from the default", async () => {
    const { store } = await started();
    store.getState().toggleFilter(["refs/heads/fix/login-redirect"]);
    await idle(store);
    expect(store.getState().filters[WEB]).toEqual([
      "HEAD",
      MAIN,
      "refs/heads/fix/login-redirect",
    ]);
    expect(subjects(store)).toContain("Redirect to home after login");
    store.getState().toggleCurrentBranchOnly();
    await idle(store);
    expect(store.getState().filters[WEB]).toEqual(["HEAD"]);
    store.getState().toggleCurrentBranchOnly();
    await idle(store);
    expect(store.getState().filters[WEB]).toEqual([]);
  });

  it("keeps following HEAD when another worktree is selected", async () => {
    const { store } = await started();
    store.getState().selectWorktree(WEB_DARK);
    await idle(store);
    expect(isDefaultFilter(store.getState())).toBe(true);
    expect(subjects(store)).toContain("Add a dark colour scheme");
    store.getState().toggleFilter([MAIN]);
    await idle(store);
    expect(store.getState().filters[WEB]).toEqual(["HEAD"]);
    store.getState().selectWorktree(WEB);
    await idle(store);
    expect(subjects(store)[0]).toBe("Document local setup");
    expect(subjects(store)).not.toContain("Add a dark colour scheme");
  });
});
