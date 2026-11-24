import { describe, expect, it } from "vitest";
import type { Reference } from "../bridge/types";
import { matchSwitcher, switcherItems } from "./switcher";

const ref = (id: string, kind: Reference["kind"]): Reference => ({
  id,
  name: id.replace(/^refs\/(heads|remotes)\//, ""),
  kind,
  target: null,
  isHead: false,
  worktreePath: null,
  subject: null,
});

describe("quick switcher", () => {
  const projects = [
    {
      path: "/w/web",
      name: "web",
      state: "ready",
      worktrees: [
        { path: "/w/web", name: "web", branch: "main", unavailable: false },
        {
          path: "/w/web-login",
          name: "web-login",
          branch: "fix/login",
          unavailable: false,
        },
        { path: "/w/gone", name: "gone", branch: null, unavailable: true },
      ],
    },
    {
      path: "/w/missing",
      name: "missing",
      state: "unavailable",
      worktrees: [],
    },
  ];
  const items = switcherItems(projects, [
    ref("refs/heads/fix/login", "local"),
    ref("refs/tags/v1", "tag"),
  ]);

  it("lists projects, available worktrees and branches", () => {
    expect(items.map((i) => i.id)).toEqual([
      "project:/w/web",
      "worktree:/w/web",
      "worktree:/w/web-login",
      "branch:refs/heads/fix/login",
    ]);
  });

  it("ranks by fuzzy match on the title", () => {
    expect(matchSwitcher(items, "wl").map((i) => i.id)[0]).toBe(
      "worktree:/w/web-login",
    );
    expect(matchSwitcher(items, "flog").map((i) => i.title)).toEqual([
      "fix/login",
    ]);
    expect(matchSwitcher(items, "")).toHaveLength(4);
  });
});
