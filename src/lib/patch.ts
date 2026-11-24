/**
 * A single-file unified diff split into hunks. Line indices match the core's `FilePatch`
 * (`src-tauri/src/git/patch.rs`), which rebuilds a patch from the indices the UI selects.
 */

export interface Hunk {
  /** Index of the `@@` line. */
  header: number;
  oldStart: number;
  newStart: number;
  /** Body line indices: [start, end). */
  start: number;
  end: number;
}

export interface ParsedPatch {
  lines: string[];
  hunks: Hunk[];
}

/** Splits on `\n`, dropping the empty piece after a trailing newline. `\r` stays on the line. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n");
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseHunkHeader(line: string): [number, number] | null {
  const match = HUNK.exec(line);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function parsePatch(text: string): ParsedPatch {
  const lines = splitLines(text);
  const starts = lines.flatMap((line, i) =>
    line.startsWith("@@ ") ? [i] : [],
  );
  const hunks = starts.flatMap((start, position) => {
    const parsed = parseHunkHeader(lines[start]);
    if (!parsed) return [];
    const end = starts[position + 1] ?? lines.length;
    return [
      {
        header: start,
        oldStart: parsed[0],
        newStart: parsed[1],
        start: start + 1,
        end,
      },
    ];
  });
  return { lines, hunks };
}

export const isChange = (line: string) =>
  line.startsWith("+") || line.startsWith("-");

export function changedLinesIn(patch: ParsedPatch, hunk: Hunk): number[] {
  const indices: number[] = [];
  for (let i = hunk.start; i < hunk.end; i += 1) {
    if (isChange(patch.lines[i])) indices.push(i);
  }
  return indices;
}

export function hunkAt(patch: ParsedPatch, index: number): Hunk | undefined {
  return patch.hunks.find(
    (hunk) =>
      hunk.header === index || (index >= hunk.start && index < hunk.end),
  );
}
