import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../../bridge";
import { groupFiles } from "./groups";

const f = (
  path: string,
  kind: ChangedFile["kind"],
  status: string,
): ChangedFile => ({
  path,
  kind,
  status,
  conflict: status === "U" ? "bothModified" : null,
});

describe("groupFiles", () => {
  it("puts conflicts first and drops empty groups", () => {
    const groups = groupFiles([
      f("a", "staged", "M"),
      f("b", "unstaged", "U"),
      f("c", "untracked", "?"),
      f("d", "unstaged", "M"),
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      "conflicts",
      "unstaged",
      "untracked",
      "staged",
    ]);
    expect(groups[0].files.map((x) => x.path)).toEqual(["b"]);
    expect(groupFiles([f("a", "staged", "A")]).map((g) => g.key)).toEqual([
      "staged",
    ]);
  });
});
