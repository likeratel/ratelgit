import { describe, expect, it } from "vitest";
import type { Reference, RemovalPreview } from "../bridge/types";
import {
  canRemove,
  changeRemoval,
  defaultStartPoint,
  folderNameFor,
  freeLocalBranches,
  initialRemoval,
  removalWarnings,
  removeOptions,
  remoteBranches,
} from "./worktreeDialog";

const ref = (id: string, extra: Partial<Reference> = {}): Reference => ({
  id,
  name: id.replace(/^refs\/(heads|remotes|tags)\//, ""),
  kind: id.startsWith("refs/heads/")
    ? "local"
    : id.startsWith("refs/remotes/")
      ? "remote"
      : "tag",
  target: "a".repeat(40),
  isHead: false,
  worktreePath: null,
  subject: null,
  ...extra,
});

const preview = (extra: Partial<RemovalPreview> = {}): RemovalPreview => ({
  path: "/work/app-topic",
  branch: "topic",
  isMain: false,
  prunable: false,
  locked: null,
  operation: null,
  changes: 0,
  untracked: 0,
  unmergedCommits: 0,
  unmergedWithRemote: 0,
  ignored: 0,
  ignoredExamples: [],
  submodules: false,
  upstream: null,
  remoteBlock: null,
  branchBlock: null,
  tip: "a".repeat(40),
  ...extra,
});

describe("new worktree dialog", () => {
  it("starts from origin/main, then origin/master, then HEAD", () => {
    expect(
      defaultStartPoint([
        ref("refs/remotes/origin/master"),
        ref("refs/remotes/origin/main"),
      ]),
    ).toBe("refs/remotes/origin/main");
    expect(defaultStartPoint([ref("refs/remotes/origin/master")])).toBe(
      "refs/remotes/origin/master",
    );
    expect(defaultStartPoint([ref("refs/heads/main")])).toBe("HEAD");
  });

  it("suggests folder names and lists branches that can be checked out", () => {
    expect(folderNameFor("feature/ui/dark")).toBe("feature-ui-dark");
    const refs = [
      ref("refs/heads/main", { worktreePath: "/work/app" }),
      ref("refs/heads/free"),
      ref("refs/remotes/origin/main"),
      ref("refs/remotes/origin/HEAD"),
      ref("refs/tags/v1"),
    ];
    expect(freeLocalBranches(refs).map((r) => r.name)).toEqual(["free"]);
    expect(remoteBranches(refs).map((r) => r.name)).toEqual(["origin/main"]);
  });
});

describe("remove worktree dialog", () => {
  it("deletes the local branch by default and never the remote one", () => {
    const state = initialRemoval(
      preview({ upstream: { remote: "origin", name: "topic" } }),
    );
    expect(state).toEqual({
      deleteBranch: true,
      deleteRemote: false,
      acknowledged: false,
    });
    expect(
      initialRemoval(preview({ branchBlock: "default branch" })).deleteBranch,
    ).toBe(false);
    expect(initialRemoval(preview({ branch: null })).deleteBranch).toBe(false);
  });

  it("lists what would be lost and needs acknowledgement for it", () => {
    const clean = preview();
    expect(removalWarnings(clean, initialRemoval(clean))).toEqual([]);
    expect(canRemove(clean, initialRemoval(clean))).toBe(true);

    const risky = preview({
      changes: 2,
      untracked: 1,
      unmergedCommits: 3,
      locked: "usb",
      operation: "merge",
    });
    const state = initialRemoval(risky);
    const warnings = removalWarnings(risky, state);
    expect(warnings).toHaveLength(4);
    expect(warnings.join(" ")).toMatch(/2 changed files and 1 untracked file/);
    expect(warnings.join(" ")).toMatch(
      /3 commits of the branch “topic” are on no other/,
    );
    const one = preview({ unmergedCommits: 1 });
    expect(removalWarnings(one, initialRemoval(one))[0]).toMatch(
      /1 commit of the branch “topic” is on/,
    );
    expect(canRemove(risky, state)).toBe(false);
    expect(canRemove(risky, { ...state, acknowledged: true })).toBe(true);
    // Keeping the branch keeps its commits, so that warning goes away.
    expect(
      removalWarnings(risky, { ...state, deleteBranch: false }),
    ).toHaveLength(3);
    expect(
      removalWarnings(
        preview({ branch: null, unmergedCommits: 1 }),
        initialRemoval(preview({ branch: null })),
      ),
    ).toHaveLength(1);
  });

  it("maps the choices to the core's options", () => {
    const risky = preview({
      changes: 1,
      unmergedCommits: 2,
      unmergedWithRemote: 2,
      upstream: { remote: "origin", name: "topic" },
    });
    expect(
      removeOptions(risky, {
        deleteBranch: true,
        deleteRemote: true,
        acknowledged: true,
      }),
    ).toMatchObject({
      force: true,
      deleteBranch: true,
      allowUnmerged: true,
      deleteRemote: true,
    });
    expect(
      removeOptions(preview(), {
        deleteBranch: false,
        deleteRemote: true,
        acknowledged: false,
      }),
    ).toMatchObject({
      force: false,
      deleteBranch: false,
      allowUnmerged: false,
      deleteRemote: false,
    });
  });
});

describe("remove worktree dialog safety", () => {
  const pushed = preview({
    unmergedCommits: 0,
    unmergedWithRemote: 1,
    upstream: { remote: "origin", name: "topic" },
  });

  it("warns about commits that only the remote branch still has", () => {
    const start = initialRemoval(pushed);
    expect(removalWarnings(pushed, start)).toEqual([]);
    const withRemote = changeRemoval(
      pushed,
      { ...start, acknowledged: true },
      { deleteRemote: true },
    );
    expect(removalWarnings(pushed, withRemote).join(" ")).toMatch(
      /1 commit of the branch “topic” is on no other/,
    );
    expect(withRemote.acknowledged).toBe(false);
    expect(canRemove(pushed, withRemote)).toBe(false);
    expect(
      removeOptions(pushed, { ...withRemote, acknowledged: true })
        .allowUnmerged,
    ).toBe(true);
  });

  it("keeps an acknowledgement when no new warning appears", () => {
    const risky = preview({ changes: 1 });
    const acked = { ...initialRemoval(risky), acknowledged: true };
    expect(
      changeRemoval(risky, acked, { deleteBranch: false }).acknowledged,
    ).toBe(true);
  });

  it("never deletes a blocked remote branch", () => {
    const blocked = preview({
      upstream: { remote: "origin", name: "main" },
      remoteBlock:
        "Its upstream is origin/main, a branch with another name, so it is kept.",
    });
    const state = changeRemoval(blocked, initialRemoval(blocked), {
      deleteRemote: true,
    });
    expect(state.deleteRemote).toBe(false);
    expect(
      removeOptions(blocked, { ...state, deleteRemote: true }).deleteRemote,
    ).toBe(false);
  });

  it("warns about ignored files and submodules and forces the removal", () => {
    const local = preview({
      ignored: 2,
      ignoredExamples: [".env", "node_modules/"],
      submodules: true,
    });
    const warnings = removalWarnings(local, initialRemoval(local)).join(" ");
    expect(warnings).toMatch(
      /2 ignored files or folders, such as \.env and node_modules\//,
    );
    expect(warnings).toMatch(/has submodules/);
    expect(removeOptions(local, initialRemoval(local)).force).toBe(true);
  });
});

describe("what the user agreed to", () => {
  it("sends the losses the dialog showed with the request", () => {
    const shown = preview({
      changes: 1,
      ignored: 2,
      unmergedCommits: 0,
      unmergedWithRemote: 3,
      upstream: { remote: "origin", name: "topic" },
      tip: "b".repeat(40),
    });
    const local = removeOptions(shown, {
      deleteBranch: true,
      deleteRemote: false,
      acknowledged: true,
    });
    expect(local.seen).toEqual({
      changes: 1,
      untracked: 0,
      ignored: 2,
      lostCommits: 0,
      locked: false,
      operation: false,
      submodules: false,
      tip: "b".repeat(40),
    });
    const remote = removeOptions(shown, {
      deleteBranch: true,
      deleteRemote: true,
      acknowledged: true,
    });
    expect(remote.seen.lostCommits).toBe(3);
  });

  it("describes submodules correctly even when they are not checked out", () => {
    const withModules = preview({ submodules: true });
    expect(
      removalWarnings(withModules, initialRemoval(withModules)).join(" "),
    ).toMatch(
      /This repository has submodules; Git needs force to remove the worktree, and any checked-out submodule folders are deleted too/,
    );
  });
});
