/**
 * Keyboard shortcuts matched on the physical key (`KeyboardEvent.code`), not the produced
 * character, so they keep working while a Korean, Japanese or other IME layout is active.
 * The primary modifier is ⌘ on macOS and Ctrl elsewhere.
 */

export interface Shortcut {
  code: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

export interface KeyLike {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  getModifierState?: (key: "AltGraph") => boolean;
}

const shortcut = (code: string, extra: Partial<Shortcut> = {}): Shortcut => ({
  code,
  mod: true,
  shift: false,
  alt: false,
  ...extra,
});

export const SHORTCUTS = {
  history: shortcut("Digit1"),
  changes: shortcut("Digit2"),
  quickOpen: shortcut("KeyP"),
  currentBranchOnly: shortcut("KeyA", { shift: true }),
  refresh: shortcut("KeyR"),
  openRepository: shortcut("KeyO"),
  previousWorktree: shortcut("BracketLeft", { alt: true }),
  nextWorktree: shortcut("BracketRight", { alt: true }),
} as const;

export type ShortcutName = keyof typeof SHORTCUTS;

export function isMac(platform: string): boolean {
  return platform === "macos";
}

export function matchesShortcut(
  event: KeyLike,
  target: Shortcut,
  mac: boolean,
): boolean {
  const modPressed = mac ? event.metaKey : event.ctrlKey;
  const otherMod = mac ? event.ctrlKey : event.metaKey;
  // Outside macOS AltGr arrives as Ctrl+Alt and types characters, so it never matches.
  if (!mac && target.alt && event.getModifierState?.("AltGraph")) return false;
  return (
    event.code === target.code &&
    modPressed === target.mod &&
    !otherMod &&
    event.shiftKey === target.shift &&
    event.altKey === target.alt
  );
}

export function findShortcut(
  event: KeyLike,
  mac: boolean,
): ShortcutName | null {
  const names = Object.keys(SHORTCUTS) as ShortcutName[];
  return (
    names.find((name) => matchesShortcut(event, SHORTCUTS[name], mac)) ?? null
  );
}

const KEY_LABELS: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
};

function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return KEY_LABELS[code] ?? code;
}

/** "⌥⇧⌘A" on macOS, "Ctrl+Alt+Shift+A" elsewhere. */
export function formatShortcut(target: Shortcut, mac: boolean): string {
  const key = keyLabel(target.code);
  if (mac) {
    return `${target.alt ? "⌥" : ""}${target.shift ? "⇧" : ""}${target.mod ? "⌘" : ""}${key}`;
  }
  return [
    target.mod && "Ctrl",
    target.alt && "Alt",
    target.shift && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
}
