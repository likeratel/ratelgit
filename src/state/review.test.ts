import { describe, expect, it, vi } from "vitest";
import type { Bridge } from "../bridge";
import { createFakeBridge } from "../bridge/fake/fakeBridge";
import { WEB, WEB_LOGIN } from "../bridge/fake/world";
import { changedLinesIn, parsePatch } from "../lib/patch";
import { addWorktreePrompt } from "./dialogs";
import { createAppStore, type AppStore } from "./store";

async function started(
  adjust: (bridge: ReturnType<typeof createFakeBridge>) => Bridge = (b) => b,
) {
  const fake = createFakeBridge();
  const store = createAppStore(adjust(fake));
  await store.getState().init();
  await idle(store);
  return { fake, store };
}

const idle = (store: AppStore) =>
  vi.waitFor(() => {
    const state = store.getState();
    expect(
      state.loading ||
        state.mutation !== null ||
        state.changesFile?.loading === true,
    ).toBe(false);
  });

const unstagedSession = (store: AppStore) =>
  store
    .getState()
    .files.find((f) => f.path === "src/session.ts" && f.kind === "unstaged")!;

describe("after an action the selected file is read again", () => {
  it("stages two hunks in a row", async () => {
    const { fake, store } = await started();
    store.getState().setMode("changes");
    await store.getState().selectFile(unstagedSession(store));
    for (let round = 0; round < 2; round += 1) {
      const view = store.getState().changesFile!;
      const patch = parsePatch(view.diff!.text);
      const lines = changedLinesIn(patch, patch.hunks[0]);
      await store.getState().execute(
        {
          type: "applyLines",
          file: view.file,
          source: view.diff!.text,
          lines,
          operation: "stage",
        },
        "Stage",
      );
      await idle(store);
      expect(store.getState().error).toBeNull();
    }
    const staged = store
      .getState()
      .files.filter((f) => f.path === "src/session.ts");
    expect(staged.map((f) => f.kind)).toEqual(["staged"]);
    expect(store.getState().changesFile?.file.kind).toBe("staged");
    expect(store.getState().changesFile?.diff?.text).toContain("compute(3)");
    expect(
      fake.controls.actions().filter((a) => a.type === "applyLines"),
    ).toHaveLength(2);
  });

  it("toggles a file twice with Space", async () => {
    const { store } = await started();
    store.getState().setMode("changes");
    await store.getState().selectFile(unstagedSession(store));
    for (const expected of ["staged", "unstaged"]) {
      const file = store.getState().changesFile!.file;
      const type = file.kind === "staged" ? "unstage" : "stage";
      await store.getState().execute({ type, file }, "Toggle");
      await idle(store);
      expect(store.getState().error).toBeNull();
      expect(store.getState().changesFile?.file.kind).toBe(expected);
      expect(store.getState().changesFile?.diff?.text).toContain("compute(3)");
    }
  });

  it("closes the conflict viewer after saving a resolution", async () => {
    const { store } = await started();
    store.getState().selectWorktree(WEB_LOGIN);
    await idle(store);
    store.getState().setMode("changes");
    const file = store
      .getState()
      .files.find((f) => f.path === "src/session.ts")!;
    await store.getState().selectFile(file);
    const view = store.getState().changesFile!;
    await store.getState().execute(
      {
        type: "saveResolution",
        file,
        fingerprint: view.conflict!.fingerprint!,
        choices: ["ours", "theirs"],
      },
      "Save Resolution",
    );
    await idle(store);
    const after = store.getState().changesFile!;
    expect(after.file.status).toBe("M");
    expect(after.conflict).toBeNull();
    expect(after.diff?.text).toContain("resolved");
  });
});

describe("errors", () => {
  it("keeps an earlier error when the worktree is read again", async () => {
    const { store } = await started();
    store.setState({ error: "Push failed. rejected" });
    store.getState().refresh();
    await idle(store);
    expect(store.getState().error).toBe("Push failed. rejected");
  });

  it("tells a successful action apart from a failed refresh", async () => {
    const { fake, store } = await started();
    fake.controls.failNext("loadWorktree", "git_failed", "index.lock exists");
    await store.getState().execute({ type: "fetch" }, "Fetch");
    expect(store.getState().error).toBe(
      "Fetch succeeded, but reading the worktree again failed. index.lock exists",
    );
  });

  it("reports a settings save that throws before it starts", async () => {
    const { store } = await started((fake) => ({
      ...fake,
      savePreferences: () => {
        throw new Error("bad settings");
      },
    }));
    store.getState().updateUi({ sidebarWidth: 300 });
    await vi.waitFor(() =>
      expect(store.getState().error).toBe(
        "Saving settings failed. bad settings",
      ),
    );
  });
});

describe("history and filters", () => {
  it("refuses a filter beyond the limit up front", async () => {
    const { fake, store } = await started();
    const many = Array.from({ length: 201 }, (_, i) => `refs/heads/b${i}`);
    store.getState().toggleFilter(many);
    expect(store.getState().filters[WEB] ?? []).toEqual([]);
    expect(store.getState().error).toMatch(/200/);
    expect(
      fake.controls.calls().filter((c) => c.command === "loadWorktree"),
    ).toHaveLength(1);
  });

  it("drops commits a later page repeats", async () => {
    const { store } = await started((fake) => ({
      ...fake,
      loadHistory: async () => {
        const first = (await fake.loadWorktree(WEB, [])).history.lines;
        return {
          lines: [
            { ...first[1], index: 99 },
            { ...first[0], hash: "f".repeat(40), index: 100 },
          ],
          complete: true,
        };
      },
    }));
    store.setState({
      history: { ...store.getState().history, complete: false },
    });
    const before = store.getState().history.lines.length;
    await store.getState().loadMoreHistory();
    const hashes = store.getState().history.lines.map((l) => l.hash);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(hashes.length).toBe(before + 1);
  });
});

describe("drafts, worktrees and focus", () => {
  it("keeps the commit draft when a merge is committed", async () => {
    const { store } = await started();
    store.getState().selectWorktree(WEB_LOGIN);
    await idle(store);
    store.getState().setDraft("Unrelated draft");
    for (const file of store.getState().files.filter((f) => f.status === "U")) {
      await store.getState().execute({ type: "keepFile", file }, "Keep");
    }
    await store
      .getState()
      .execute(
        { type: "continue", operation: "merge", message: "Merge" },
        "Commit Merge",
      );
    expect(store.getState().drafts[WEB_LOGIN]).toBe("Unrelated draft");
  });

  it("adds a worktree in a folder picked by the core", async () => {
    const { fake, store } = await started();
    const branch = store
      .getState()
      .references.find((r) => r.id === "refs/heads/feature/auth/oauth")!;
    store.getState().ask(addWorktreePrompt(branch, WEB));
    await store.getState().chooseWorktreeParent();
    expect(store.getState().worktreeParent?.path).toBe("/work/trees");
    store.getState().submitPrompt("ratel-web-oauth");
    await idle(store);
    expect(fake.controls.actions().at(-1)).toEqual({
      type: "addWorktree",
      reference: branch.id,
      parent: "parent-1",
      name: "ratel-web-oauth",
    });
  });

  it("refreshes quietly when the window comes back", async () => {
    const { fake, store } = await started();
    const commit = store.getState().history.lines[2].hash;
    await store.getState().selectCommit(commit);
    store.getState().setDraft("Half written");
    store.setState({ mode: "changes" });
    await store.getState().selectFile(unstagedSession(store));
    // Something outside the app stages the file.
    await fake.runAction(WEB, { type: "stage", file: unstagedSession(store) });
    await store.getState().refreshQuietly();
    const state = store.getState();
    expect(
      state.files.filter((f) => f.path === "src/session.ts").map((f) => f.kind),
    ).toEqual(["staged"]);
    expect(state.commit?.hash).toBe(commit);
    expect(state.drafts[WEB]).toBe("Half written");
    expect(state.changesFile?.file.kind).toBe("staged");
    expect(state.error).toBeNull();
  });
});
