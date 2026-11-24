import { describe, expect, it, vi } from "vitest";
import { createFakeBridge } from "../bridge/fake/fakeBridge";
import { API, WEB, WEB_DARK, WEB_LOGIN } from "../bridge/fake/world";
import { createAppStore } from "./store";

async function started(
  configure?: (fake: ReturnType<typeof createFakeBridge>) => void,
) {
  const fake = createFakeBridge();
  configure?.(fake);
  const store = createAppStore(fake);
  await store.getState().init();
  await vi.waitFor(() => expect(store.getState().loading).toBe(false));
  return { fake, store };
}

const idle = (store: Awaited<ReturnType<typeof started>>["store"]) =>
  vi.waitFor(() => {
    const state = store.getState();
    expect(state.loading || state.mutation !== null).toBe(false);
  });

describe("app store", () => {
  it("opens the last worktree and lists projects", async () => {
    const { store } = await started();
    const state = store.getState();
    expect(state.projects.map((p) => p.name)).toEqual([
      "ratel-web",
      "api-server",
    ]);
    expect(state.activePath).toBe(WEB);
    expect(state.history.lines[0].subject).toBe("Document local setup");
    expect(state.files.map((f) => f.path)).toContain("src/session.ts");
  });

  it("keeps only the latest worktree after rapid switches", async () => {
    const { fake, store } = await started();
    fake.controls.setLatency((call) =>
      call.command === "loadWorktree" && call.args[0] === WEB_DARK ? 120 : 5,
    );
    const { selectWorktree } = store.getState();
    selectWorktree(WEB_DARK);
    selectWorktree(WEB_LOGIN);
    selectWorktree(WEB_DARK);
    selectWorktree(WEB);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const state = store.getState();
    expect(state.activePath).toBe(WEB);
    expect(state.files.map((f) => f.path)).toEqual([
      "src/session.ts",
      "notes.txt",
      "src/retry.ts",
    ]);
    store.getState().moveWorktree(1);
    await idle(store);
    expect(store.getState().activePath).toBe(WEB_DARK);
    expect(store.getState().files.map((f) => f.path)).toEqual([
      "src/theme.css",
    ]);
  });

  it("keeps filters per project and saves them", async () => {
    const { fake, store } = await started();
    store.getState().clearFilter();
    await idle(store);
    store
      .getState()
      .toggleFilter([
        "refs/heads/fix/login-redirect",
        "refs/heads/feature/auth/oauth",
      ]);
    await idle(store);
    expect(store.getState().filters[WEB]).toHaveLength(2);
    expect(store.getState().history.headHidden).toBe(true);
    const subjects = store.getState().history.lines.map((l) => l.subject);
    expect(subjects).toContain("Redirect to home after login");
    expect(subjects).not.toContain("Document local setup");

    store.getState().selectProject(API);
    await idle(store);
    expect(store.getState().filters[API] ?? []).toEqual([]);
    expect(store.getState().history.lines[0].subject).toBe(
      "Rate-limit the login endpoint",
    );
    store.getState().selectWorktree(WEB);
    await idle(store);
    expect(store.getState().filters[WEB]).toHaveLength(2);

    store.getState().toggleCurrentBranchOnly();
    await idle(store);
    expect(store.getState().filters[WEB]).toEqual(["HEAD"]);
    store.getState().clearFilter();
    await idle(store);
    expect(store.getState().filters[WEB]).toEqual([]);
    await vi.waitFor(() =>
      expect(
        fake.controls.calls().some((c) => c.command === "savePreferences"),
      ).toBe(true),
    );
  });

  it("keeps commit drafts with their worktree", async () => {
    const { fake, store } = await started();
    store.getState().setDraft("Main draft");
    store.getState().selectWorktree(WEB_DARK);
    await idle(store);
    expect(store.getState().drafts[WEB_DARK] ?? "").toBe("");
    store.getState().selectWorktree(WEB);
    await idle(store);
    expect(store.getState().drafts[WEB]).toBe("Main draft");
    await store
      .getState()
      .execute({ type: "commit", message: "Main draft" }, "Commit");
    expect(store.getState().drafts[WEB]).toBe("");
    expect(store.getState().history.lines[0].subject).toBe("Main draft");
    expect(fake.controls.actions().at(-1)).toEqual({
      type: "commit",
      message: "Main draft",
    });
  });

  it("asks before force-deleting an unmerged branch", async () => {
    const { store } = await started();
    const branch = "refs/heads/feature/auth/oauth";
    await store
      .getState()
      .execute(
        { type: "deleteBranch", reference: branch, force: false },
        "Delete Branch",
      );
    const confirmation = store.getState().confirmation;
    expect(confirmation?.action).toEqual({
      type: "deleteBranch",
      reference: branch,
      force: true,
    });
    expect(store.getState().references.some((r) => r.id === branch)).toBe(true);
    store.getState().runConfirmation();
    await idle(store);
    expect(store.getState().references.some((r) => r.id === branch)).toBe(
      false,
    );
    expect(store.getState().error).toBeNull();
  });

  it("shows a failure as a failure and still refreshes", async () => {
    const { fake, store } = await started();
    fake.controls.failNext(
      "runAction",
      "git_failed",
      "fatal: unable to access remote",
    );
    await store.getState().execute({ type: "fetch" }, "Fetch");
    expect(store.getState().error).toBe(
      "Fetch failed. fatal: unable to access remote",
    );
    expect(store.getState().mutation).toBeNull();
    expect(
      fake.controls.calls().filter((c) => c.command === "loadWorktree").length,
    ).toBeGreaterThan(1);
  });

  it("drops a history page that belongs to an older listing", async () => {
    const { fake, store } = await started();
    store.setState({
      history: { ...store.getState().history, complete: false },
    });
    fake.controls.setLatency((call) =>
      call.command === "loadHistory" ? 80 : 0,
    );
    const page = store.getState().loadMoreHistory();
    store.getState().toggleCurrentBranchOnly();
    await page;
    await idle(store);
    const lines = store.getState().history.lines;
    expect(new Set(lines.map((l) => l.hash)).size).toBe(lines.length);
  });

  it("resolves a conflict chunk by chunk", async () => {
    const { fake, store } = await started();
    store.getState().selectWorktree(WEB_LOGIN);
    await idle(store);
    expect(store.getState().operation?.kind).toBe("merge");
    const conflicted = store
      .getState()
      .files.find((f) => f.path === "src/session.ts");
    expect(conflicted?.conflict).toBe("bothModified");
    store.setState({ mode: "changes" });
    await store.getState().selectFile(conflicted!);
    const view = store.getState().changesFile;
    expect(view?.conflict?.state).toBe("ready");
    expect(view?.choices).toEqual([null, null]);
    store.getState().chooseChunk(0, "theirs");
    store.getState().chooseChunk(1, "oursThenTheirs");
    const chosen = store.getState().changesFile;
    await store.getState().execute(
      {
        type: "saveResolution",
        file: chosen!.file,
        fingerprint: chosen!.conflict!.fingerprint!,
        choices: ["theirs", "oursThenTheirs"],
      },
      "Save Resolution",
    );
    expect(store.getState().operation?.conflicts).toBe(1);
    expect(fake.controls.actions().at(-1)?.type).toBe("saveResolution");
  });

  it("asks before marking a file with markers resolved", async () => {
    const { fake, store } = await started();
    store.getState().selectWorktree(WEB_LOGIN);
    await idle(store);
    const file = store
      .getState()
      .files.find((f) => f.path === "src/session.ts")!;
    fake.controls.failNext(
      "runAction",
      "conflict_markers",
      "still contains conflict markers",
    );
    await store
      .getState()
      .execute({ type: "markResolved", file, force: false }, "Mark Resolved");
    expect(store.getState().confirmation?.action).toEqual({
      type: "markResolved",
      file,
      force: true,
    });
    expect(store.getState().error).toBeNull();
  });
});
