import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../../bridge";
import { stagingOperations } from "./staging";

const file = (kind: ChangedFile["kind"], status = "M"): ChangedFile => ({
  path: "a",
  kind,
  status,
  conflict: null,
});
const diff = { text: "@@ -1 +1 @@\n-a\n+b\n", lossy: false, truncated: false };

describe("stagingOperations", () => {
  it("offers hunk actions only for plain working diffs", () => {
    expect(stagingOperations(file("unstaged"), diff, false)).toEqual([
      "stage",
      "discard",
    ]);
    expect(stagingOperations(file("staged"), diff, false)).toEqual(["unstage"]);
    expect(stagingOperations(file("untracked"), diff, false)).toEqual([]);
    expect(stagingOperations(file("committed"), diff, false)).toEqual([]);
    expect(stagingOperations(file("unstaged"), diff, true)).toEqual([]);
    expect(
      stagingOperations(file("unstaged"), { ...diff, lossy: true }, false),
    ).toEqual([]);
    expect(stagingOperations(file("unstaged", "U"), diff, false)).toEqual([]);
    expect(
      stagingOperations(
        file("unstaged"),
        { ...diff, text: "Binary files differ\n" },
        false,
      ),
    ).toEqual([]);
  });
});
