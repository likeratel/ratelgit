import { describe, expect, it } from "vitest";
import { badgesFor, shortenRef } from "./badges";

describe("badgesFor", () => {
  it("folds a remote twin into the local badge and keeps others", () => {
    const remotes = new Set(["origin/main", "origin/feature/x", "origin/HEAD"]);
    const badges = badgesFor(
      [
        "HEAD -> main",
        "origin/main",
        "origin/HEAD",
        "tag: v1.0",
        "origin/feature/x",
        "side",
      ],
      remotes,
    );
    expect(badges).toEqual([
      { text: "main", kind: "head", remote: "origin/main" },
      { text: "v1.0", kind: "tag", remote: null },
      { text: "origin/feature/x", kind: "remote", remote: null },
      { text: "side", kind: "local", remote: null },
    ]);
  });

  it("shortens long names in the middle", () => {
    expect(shortenRef("main")).toBe("main");
    const long = shortenRef("feature/ui/a-very-long-dark-mode-branch");
    expect(Array.from(long).length).toBe(25);
    expect(long.startsWith("feature/ui/a")).toBe(true);
    expect(long.endsWith("mode-branch")).toBe(true);
  });
});
