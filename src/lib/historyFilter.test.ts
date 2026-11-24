import { describe, expect, it } from "vitest";
import {
  isCurrentBranchOnly,
  pruneFilter,
  removeRef,
  renameRef,
  sameFilter,
  toggleCurrentBranch,
  toggleRefs,
} from "./historyFilter";

const a = "refs/heads/feature/a";
const b = "refs/heads/feature/b";

describe("history filter", () => {
  it("toggles a folder as a unit and unions single refs", () => {
    const folder = toggleRefs([], [a, b]);
    expect(folder).toEqual([a, b]);
    expect(toggleRefs(folder, [a, b])).toEqual([]);
    expect(toggleRefs([a], [a, b])).toEqual([a, b]);
    expect(toggleRefs([a, b], [a])).toEqual([b]);
  });

  it("switches between current branch only and everything", () => {
    expect(toggleCurrentBranch([])).toEqual(["HEAD"]);
    expect(isCurrentBranchOnly(toggleCurrentBranch([]))).toBe(true);
    expect(toggleCurrentBranch(["HEAD"])).toEqual([]);
    expect(toggleCurrentBranch([a])).toEqual(["HEAD"]);
    expect(toggleRefs(["HEAD"], [a])).toEqual(["HEAD", a]);
    expect(toggleRefs(["HEAD", a], [a])).toEqual(["HEAD"]);
  });

  it("prunes, renames and removes", () => {
    expect(pruneFilter([a, b, "HEAD"], [{ id: a }])).toEqual([a, "HEAD"]);
    expect(renameRef([a, b], a, "refs/heads/feature/c")).toEqual([
      "refs/heads/feature/c",
      b,
    ]);
    expect(renameRef([b], a, "x")).toEqual([b]);
    expect(removeRef([a, b], a)).toEqual([b]);
    expect(sameFilter([a, b], [b, a])).toBe(true);
    expect(sameFilter([a], [a, b])).toBe(false);
  });
});
