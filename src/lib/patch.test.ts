import { describe, expect, it } from "vitest";
import { changedLinesIn, hunkAt, parsePatch, splitLines } from "./patch";
import { buildDocument, emphasisPieces, splitRows } from "./patchDocument";

describe("parsePatch", () => {
  it("uses the same line indices as the core", () => {
    const text =
      "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -10,2 +10,3 @@\n x\n+y\n z\n";
    const patch = parsePatch(text);
    expect(patch.hunks.map((h) => h.header)).toEqual([3, 8]);
    expect(patch.hunks.flatMap((h) => changedLinesIn(patch, h))).toEqual([
      5, 6, 10,
    ]);
    expect(hunkAt(patch, 10)?.header).toBe(8);
    expect(hunkAt(patch, 1)).toBeUndefined();
    expect(splitLines("a\r\nb\n")).toEqual(["a\r", "b"]);
  });
});

describe("buildDocument", () => {
  it("numbers lines and aligns the split view", () => {
    const document = buildDocument(
      "@@ -10,3 +20,4 @@\n unchanged\n-old\n+new\n+extra\n last\n",
    );
    expect(document.lines.map((l) => l.old)).toEqual([
      null,
      10,
      11,
      null,
      null,
      12,
    ]);
    expect(document.lines.map((l) => l.new)).toEqual([
      null,
      20,
      null,
      21,
      22,
      23,
    ]);
    const rows = splitRows(document.display);
    expect(rows[2].left?.text).toBe("old");
    expect(rows[2].right?.text).toBe("new");
    expect(rows[3].left).toBeNull();
  });

  it("drops file headers, strips CR and emphasizes changed words", () => {
    const document = buildDocument(
      "diff --git a/f b/f\nindex 1..2\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-let a = 1;\r\n+let a = 2;\r\n",
    );
    expect(document.display[0].isHunkHeader).toBe(true);
    expect(document.display[1].text).toBe("let a = 1;");
    expect(document.display[2].emphasis).toEqual([[8, 9]]);
    expect(emphasisPieces("let a = 2;", [[8, 9]])).toEqual([
      { text: "let a = ", strong: false },
      { text: "2", strong: true },
      { text: ";", strong: false },
    ]);
  });

  it("keeps binary notices visible", () => {
    const document = buildDocument(
      "diff --git a/i b/i\nBinary files a/i and b/i differ\n",
    );
    expect(document.display.map((l) => l.text)).toEqual([
      "Binary files a/i and b/i differ",
    ]);
  });
});
