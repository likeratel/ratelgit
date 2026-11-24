import { describe, expect, it } from "vitest";
import { fuzzyRank, fuzzyScore } from "./fuzzy";

describe("fuzzy matching", () => {
  it("matches subsequences in order", () => {
    expect(fuzzyScore("fxy", "feature/x/y")).not.toBeNull();
    expect(fuzzyScore("yxf", "feature/x/y")).toBeNull();
    expect(fuzzyScore("", "anything")).toBe(0);
    expect(fuzzyScore("FEAT", "feature")).not.toBeNull();
  });

  it("ranks prefixes and word starts first", () => {
    const ranked = fuzzyRank(
      ["src-main-helper", "main", "domain", "maintenance"],
      "main",
      (s) => s,
    );
    expect(ranked[0]).toBe("main");
    expect(ranked.at(-1)).toBe("domain");
    expect(
      fuzzyRank(["fix/login", "feature/login", "docs"], "flog", (s) => s),
    ).toEqual(["fix/login", "feature/login"]);
    expect(fuzzyScore("rg", "ratel-git") ?? 0).toBeGreaterThan(
      fuzzyScore("rg", "larger") ?? 0,
    );
  });
});
