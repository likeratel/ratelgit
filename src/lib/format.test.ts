import { describe, expect, it } from "vitest";
import { formatDateTime, plural, splitMessage } from "./format";

describe("format", () => {
  it("pluralizes and splits messages", () => {
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(1200, "commit")).toBe("1,200 commits");
    expect(splitMessage("Fix it\n\nBecause.\n")).toEqual({
      subject: "Fix it",
      body: "Because.",
    });
    expect(splitMessage("One line")).toEqual({ subject: "One line", body: "" });
    expect(formatDateTime("not a date")).toBe("not a date");
    expect(formatDateTime("2026-02-26T18:13:00+00:00")).toMatch(/2026/);
  });
});
