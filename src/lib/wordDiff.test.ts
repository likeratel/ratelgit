import { describe, expect, it } from "vitest";
import { tokens, wordChanges } from "./wordDiff";

describe("wordChanges", () => {
  it("marks only changed words", () => {
    const changes = wordChanges(
      "let value = compute(1, 2)",
      "let total = compute(1, 3)",
    );
    expect(changes?.removed).toEqual([
      [4, 9],
      [23, 24],
    ]);
    expect(changes?.added).toEqual([
      [4, 9],
      [23, 24],
    ]);
    expect(wordChanges("print(a)", "print(a, b)")).toEqual({
      removed: [],
      added: [[7, 10]],
    });
  });

  it("handles Hangul and unrelated lines", () => {
    expect(wordChanges("같은 줄", "같은 줄")).toEqual({
      removed: [],
      added: [],
    });
    expect(wordChanges("안녕 세상 이야기", "안녕 우주 이야기")?.added).toEqual([
      [3, 5],
    ]);
    expect(
      wordChanges("completely different", "nothing shared here"),
    ).toBeNull();
  });

  it("splits words, spaces and punctuation", () => {
    expect(tokens("a_b  c(d)")).toEqual(["a_b", "  ", "c", "(", "d", ")"]);
  });
});
