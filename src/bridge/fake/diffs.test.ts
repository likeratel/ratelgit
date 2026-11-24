import { describe, expect, it } from "vitest";
import {
  afterApplying,
  afterReverting,
  allChanged,
  combine,
  onlySelected,
} from "./diffs";

const text =
  "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -9,1 +9,2 @@\n x\n+y\n";

describe("fake diff moves", () => {
  it("moves the first hunk and leaves the second", () => {
    const first = new Set([5, 6]);
    expect(afterApplying(text, first)).toBe(
      "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -9,1 +9,2 @@\n x\n+y\n",
    );
    expect(onlySelected(text, first)).toBe(
      "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n",
    );
    expect(afterReverting(text, new Set([9]))).toBe(
      "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n",
    );
    expect(afterApplying(text, allChanged(text))).toBeNull();
    expect(combine(undefined, "x\n")).toBe("x\n");
  });
});
