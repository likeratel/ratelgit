/**
 * How the fake core's working diffs change when lines move between the work tree, the index
 * and HEAD. Close enough to Git for the UI to see the same sequence of diffs it would get
 * from the real core; it does not recount hunk headers.
 */

import { splitLines } from "../../lib/patch";
import type { ChangeKind } from "../types";

export const diffKey = (worktree: string, kind: ChangeKind, path: string) =>
  `${worktree}|${kind}|${path}`;

interface Parsed {
  header: string[];
  hunks: { header: string; lines: { index: number; text: string }[] }[];
}

function parse(text: string): Parsed {
  const lines = splitLines(text);
  const first = lines.findIndex((l) => l.startsWith("@@ "));
  const cut = first < 0 ? lines.length : first;
  const hunks: Parsed["hunks"] = [];
  lines.slice(cut).forEach((text, offset) => {
    const index = cut + offset;
    if (text.startsWith("@@ ")) hunks.push({ header: text, lines: [] });
    else hunks.at(-1)?.lines.push({ index, text });
  });
  return { header: lines.slice(0, cut), hunks };
}

function render(parsed: Parsed): string | null {
  const hunks = parsed.hunks.filter((h) =>
    h.lines.some((l) => /^[+-]/.test(l.text)),
  );
  if (hunks.length === 0) return null;
  const body = hunks.flatMap((h) => [h.header, ...h.lines.map((l) => l.text)]);
  return [...parsed.header, ...body].join("\n") + "\n";
}

type Rule = (text: string, selected: boolean) => string | null;

function rewrite(
  text: string,
  rule: Rule,
  selected: ReadonlySet<number>,
): string | null {
  const parsed = parse(text);
  return render({
    header: parsed.header,
    hunks: parsed.hunks.map((hunk) => ({
      header: hunk.header,
      lines: hunk.lines.flatMap((line) => {
        const next = rule(line.text, selected.has(line.index));
        return next === null ? [] : [{ index: line.index, text: next }];
      }),
    })),
  });
}

/** The diff left after the selected changes moved into its base (staged, or committed). */
export function afterApplying(
  text: string,
  selected: ReadonlySet<number>,
): string | null {
  return rewrite(
    text,
    (line, chosen) => {
      if (!chosen) return line;
      if (line.startsWith("+")) return ` ${line.slice(1)}`;
      return line.startsWith("-") ? null : line;
    },
    selected,
  );
}

/** The diff left after the selected changes were undone in its target. */
export function afterReverting(
  text: string,
  selected: ReadonlySet<number>,
): string | null {
  return rewrite(
    text,
    (line, chosen) => {
      if (!chosen) return line;
      if (line.startsWith("-")) return ` ${line.slice(1)}`;
      return line.startsWith("+") ? null : line;
    },
    selected,
  );
}

/** Only the selected changes, as a diff of their own. */
export function onlySelected(
  text: string,
  selected: ReadonlySet<number>,
): string | null {
  return rewrite(
    text,
    (line, chosen) => {
      if (chosen) return line;
      if (line.startsWith("-")) return ` ${line.slice(1)}`;
      return line.startsWith("+") ? null : line;
    },
    selected,
  );
}

/** Two diffs of the same file shown as one: the hunks of `extra` after those of `base`. */
export function combine(
  base: string | undefined,
  extra: string | null,
): string | null {
  if (!extra) return base ?? null;
  if (!base) return extra;
  const added = parse(extra).hunks.flatMap((h) => [
    h.header,
    ...h.lines.map((l) => l.text),
  ]);
  return `${base}${added.join("\n")}\n`;
}

export function allChanged(text: string): Set<number> {
  return new Set(
    parse(text).hunks.flatMap((h) =>
      h.lines.filter((l) => /^[+-]/.test(l.text)).map((l) => l.index),
    ),
  );
}
