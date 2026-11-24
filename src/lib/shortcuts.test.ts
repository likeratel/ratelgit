import { describe, expect, it } from "vitest";
import {
  findShortcut,
  formatShortcut,
  SHORTCUTS,
  type KeyLike,
} from "./shortcuts";

const key = (code: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  code,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...extra,
});

describe("shortcuts", () => {
  it("matches the physical key with the platform modifier", () => {
    expect(findShortcut(key("Digit1", { metaKey: true }), true)).toBe(
      "history",
    );
    expect(findShortcut(key("Digit2", { ctrlKey: true }), false)).toBe(
      "changes",
    );
    expect(findShortcut(key("Digit1", { ctrlKey: true }), true)).toBeNull();
    expect(
      findShortcut(key("KeyA", { metaKey: true, shiftKey: true }), true),
    ).toBe("currentBranchOnly");
    expect(findShortcut(key("KeyA", { metaKey: true }), true)).toBeNull();
  });

  it("works while an IME produces other characters", () => {
    // With a Korean layout `KeyP` types "ㅔ", but the code stays KeyP.
    expect(findShortcut(key("KeyP", { metaKey: true }), true)).toBe(
      "quickOpen",
    );
  });

  it("ignores AltGr outside macOS", () => {
    const altGr = key("BracketLeft", {
      ctrlKey: true,
      altKey: true,
      getModifierState: () => true,
    });
    expect(findShortcut(altGr, false)).toBeNull();
  });

  it("formats labels per platform", () => {
    expect(formatShortcut(SHORTCUTS.currentBranchOnly, true)).toBe("⇧⌘A");
    expect(formatShortcut(SHORTCUTS.currentBranchOnly, false)).toBe(
      "Ctrl+Shift+A",
    );
    expect(formatShortcut(SHORTCUTS.nextWorktree, true)).toBe("⌥⌘]");
  });
});
