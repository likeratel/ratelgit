import { describe, expect, it } from "vitest";
import type { OperationState, Segment } from "../bridge/types";
import {
  choose,
  describeConflict,
  emptyChoices,
  markerLabel,
  nextUnresolved,
  operationTitle,
  previewLines,
  quickResolutions,
  unresolvedCount,
} from "./conflict";

const segments: Segment[] = [
  { type: "text", lines: ["top\r\n"] },
  {
    type: "conflict",
    oursLabel: "HEAD",
    baseLabel: null,
    theirsLabel: "main",
    ours: ["ours\r\n"],
    base: null,
    theirs: ["theirs\r\n"],
  },
  { type: "text", lines: ["middle\n"] },
  {
    type: "conflict",
    oursLabel: "HEAD",
    baseLabel: "base",
    theirsLabel: "main",
    ours: ["a\n"],
    base: ["o\n"],
    theirs: ["b\n"],
  },
];

const merge: OperationState = {
  kind: "merge",
  ours: "fix/login",
  theirs: "main",
  branch: null,
  step: null,
  total: null,
  conflicts: 1,
  message: null,
};

describe("conflict choices", () => {
  it("tracks unresolved chunks and moves between them", () => {
    const start = emptyChoices(segments);
    expect(start).toEqual([null, null]);
    expect(unresolvedCount(start)).toBe(2);
    const one = choose(start, 0, "theirs");
    expect(unresolvedCount(one)).toBe(1);
    expect(nextUnresolved(one, 0, 1)).toBe(1);
    expect(nextUnresolved(one, 1, -1)).toBe(1);
    expect(nextUnresolved(choose(one, 1, "ours"), 0, 1)).toBeNull();
  });

  it("previews the result in order with line origins", () => {
    const lines = previewLines(segments, ["oursThenTheirs", null]);
    expect(lines.map((l) => [l.text, l.origin])).toEqual([
      ["top", "text"],
      ["ours", "ours"],
      ["theirs", "theirs"],
      ["middle", "text"],
      ["", "pending"],
    ]);
    const swapped = previewLines(segments, ["theirsThenOurs", "theirs"]);
    expect(swapped.map((l) => l.text)).toEqual([
      "top",
      "theirs",
      "ours",
      "middle",
      "b",
    ]);
  });
});

describe("conflict labels", () => {
  it("names sides by branch rather than ours and theirs", () => {
    expect(markerLabel("HEAD", "fix/login")).toBe("HEAD · fix/login");
    expect(markerLabel("main", "main")).toBe("main");
    expect(describeConflict("deletedByThem", merge)).toBe(
      "Deleted in main, changed in fix/login",
    );
    expect(operationTitle(merge)).toBe("Merging main into fix/login");
    expect(
      operationTitle({
        ...merge,
        kind: "rebase",
        ours: "main",
        branch: "topic",
        step: 1,
        total: 3,
      }),
    ).toBe("Rebasing topic onto main (step 1 of 3)");
  });

  it("offers whole-file actions that fit the conflict", () => {
    expect(quickResolutions("bothModified")).toEqual(["useOurs", "useTheirs"]);
    expect(quickResolutions("deletedByUs")).toEqual(["keep", "delete"]);
    expect(quickResolutions("bothDeleted")).toEqual(["delete"]);
  });
});
