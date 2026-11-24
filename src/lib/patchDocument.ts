/** Display model of a diff: numbered lines, word emphasis and split-view rows. */

import { parseHunkHeader, splitLines } from "./patch";
import { wordChanges, type Range } from "./wordDiff";

export type LineKind = "context" | "added" | "removed" | "header";

export interface PatchLine {
  /** Position in the diff text; the index the core uses for line staging. */
  index: number;
  text: string;
  old: number | null;
  new: number | null;
  kind: LineKind;
  /** Code point ranges that differ from the paired removed or added line. */
  emphasis: Range[];
  isHunkHeader: boolean;
}

export interface SplitRow {
  key: number;
  left: PatchLine | null;
  right: PatchLine | null;
}

const FILE_HEADERS = ["diff --git ", "index ", "--- ", "+++ "];
/** Word emphasis is skipped for very long lines, where it costs more than it helps. */
const MAX_EMPHASIS_LENGTH = 2000;

const stripCR = (text: string) =>
  text.endsWith("\r") ? text.slice(0, -1) : text;

function parseLines(text: string): PatchLine[] {
  let old: number | null = null;
  let next: number | null = null;
  return splitLines(text).map((raw, index) => {
    const base = { index, emphasis: [], isHunkHeader: false };
    const hunk = raw.startsWith("@@ ") ? parseHunkHeader(raw) : null;
    if (hunk) {
      [old, next] = hunk;
      return {
        ...base,
        text: stripCR(raw),
        old: null,
        new: null,
        kind: "header",
        isHunkHeader: true,
      };
    }
    if (old !== null && next !== null) {
      const body = stripCR(raw.slice(1));
      if (raw.startsWith(" ")) {
        const line = {
          ...base,
          text: body,
          old,
          new: next,
          kind: "context" as const,
        };
        old += 1;
        next += 1;
        return line;
      }
      if (raw.startsWith("+")) {
        const line = {
          ...base,
          text: body,
          old: null,
          new: next,
          kind: "added" as const,
        };
        next += 1;
        return line;
      }
      if (raw.startsWith("-")) {
        const line = {
          ...base,
          text: body,
          old,
          new: null,
          kind: "removed" as const,
        };
        old += 1;
        return line;
      }
    }
    return {
      ...base,
      text: stripCR(raw),
      old: null,
      new: null,
      kind: "header",
    };
  });
}

/** Pairs the n-th removed line of a change block with its n-th added line. */
function emphasize(lines: PatchLine[]): Map<number, Range[]> {
  const result = new Map<number, Range[]>();
  let removed: PatchLine[] = [];
  let added: PatchLine[] = [];
  const flush = () => {
    removed.forEach((left, n) => {
      const right = added[n];
      if (
        !right ||
        left.text.length > MAX_EMPHASIS_LENGTH ||
        right.text.length > MAX_EMPHASIS_LENGTH
      )
        return;
      const changes = wordChanges(left.text, right.text);
      if (!changes) return;
      result.set(left.index, changes.removed);
      result.set(right.index, changes.added);
    });
    removed = [];
    added = [];
  };
  lines.forEach((line) => {
    if (line.kind === "removed") {
      if (added.length) flush();
      removed = [...removed, line];
    } else if (line.kind === "added") {
      added = [...added, line];
    } else {
      flush();
    }
  });
  flush();
  return result;
}

export interface PatchDocument {
  lines: PatchLine[];
  /** Lines worth showing: the `diff --git`, `index`, `---` and `+++` lines are dropped when hunks follow. */
  display: PatchLine[];
  longest: number;
}

export function buildDocument(text: string): PatchDocument {
  const parsed = parseLines(text);
  const emphasis = emphasize(parsed);
  const lines = parsed.map((line) => ({
    ...line,
    emphasis: emphasis.get(line.index) ?? [],
  }));
  const firstHunk = lines.findIndex((line) => line.isHunkHeader);
  const cut = firstHunk < 0 ? lines.length : firstHunk;
  const display = lines.filter(
    (line) =>
      line.index >= cut ||
      !FILE_HEADERS.some((prefix) => line.text.startsWith(prefix)),
  );
  // Hunk headers span the whole row, so only code lines set the scroll width.
  const longest = display.reduce(
    (max, line) =>
      line.kind === "header" ? max : Math.max(max, line.text.length),
    0,
  );
  return { lines, display, longest };
}

export function splitRows(display: readonly PatchLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let left: PatchLine[] = [];
  let right: PatchLine[] = [];
  const flush = () => {
    for (let n = 0; n < Math.max(left.length, right.length); n += 1) {
      rows.push({
        key: rows.length,
        left: left[n] ?? null,
        right: right[n] ?? null,
      });
    }
    left = [];
    right = [];
  };
  display.forEach((line) => {
    if (line.kind === "removed") left = [...left, line];
    else if (line.kind === "added") right = [...right, line];
    else {
      flush();
      rows.push({
        key: rows.length,
        left: line,
        right: line.kind === "context" ? line : null,
      });
    }
  });
  flush();
  return rows;
}

/** Splits text into plain and emphasized pieces; tabs become four spaces. */
export function emphasisPieces(
  text: string,
  emphasis: readonly Range[],
): { text: string; strong: boolean }[] {
  const characters = Array.from(text);
  const pieces: { text: string; strong: boolean }[] = [];
  let cursor = 0;
  const push = (start: number, end: number, strong: boolean) => {
    if (end > start)
      pieces.push({
        text: characters.slice(start, end).join("").replace(/\t/g, "    "),
        strong,
      });
  };
  [...emphasis]
    .sort((a, b) => a[0] - b[0])
    .forEach(([start, end]) => {
      if (start < cursor || end > characters.length) return;
      push(cursor, start, false);
      push(start, end, true);
      cursor = end;
    });
  push(cursor, characters.length, false);
  return pieces;
}
