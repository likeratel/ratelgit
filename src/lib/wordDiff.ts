/**
 * Changed character ranges between a removed line and the added line paired with it.
 * Ranges count Unicode code points, as `Array.from` splits a string.
 */

export type Range = readonly [start: number, end: number];

export interface WordChanges {
  removed: Range[];
  added: Range[];
}

/** Above this many token pairs the middle part is treated as one change instead of running LCS. */
const MAX_COMPARISONS = 60_000;
/** Lines that share less than this fraction of characters are shown without word emphasis. */
const MIN_SHARED = 0.35;

const WORD = /[\p{L}\p{N}_]/u;
const SPACE = /\s/u;

function classOf(character: string): number {
  if (WORD.test(character)) return 0;
  return SPACE.test(character) ? 1 : 2;
}

/** Words, runs of whitespace, and single punctuation characters. */
export function tokens(text: string): string[] {
  return Array.from(text).reduce<{ out: string[]; kind: number }>(
    (state, character) => {
      const kind = classOf(character);
      const last = state.out.at(-1);
      const joins = last !== undefined && kind === state.kind && kind !== 2;
      return {
        out: joins
          ? [...state.out.slice(0, -1), last + character]
          : [...state.out, character],
        kind,
      };
    },
    { out: [], kind: -1 },
  ).out;
}

function commonTokens(
  left: string[],
  right: string[],
): [Set<number>, Set<number>] {
  if (
    !left.length ||
    !right.length ||
    left.length * right.length > MAX_COMPARISONS
  ) {
    return [new Set(), new Set()];
  }
  const table = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        left[i] === right[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const keptLeft = new Set<number>();
  const keptRight = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      keptLeft.add(i);
      keptRight.add(j);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return [keptLeft, keptRight];
}

/** Code point ranges of changed tokens, with neighbouring ranges merged. */
function ranges(list: string[], changed: Set<number>): Range[] {
  const result: [number, number][] = [];
  let offset = 0;
  list.forEach((token, index) => {
    const start = offset;
    offset += Array.from(token).length;
    if (!changed.has(index)) return;
    const last = result.at(-1);
    if (last && last[1] === start) last[1] = offset;
    else result.push([start, offset]);
  });
  return result;
}

const span = (list: Range[]) => list.reduce((sum, [a, b]) => sum + b - a, 0);

export function wordChanges(
  oldText: string,
  newText: string,
): WordChanges | null {
  const left = tokens(oldText);
  const right = tokens(newText);
  let prefix = 0;
  while (
    prefix < left.length &&
    prefix < right.length &&
    left[prefix] === right[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const leftMiddle = left.slice(prefix, left.length - suffix);
  const rightMiddle = right.slice(prefix, right.length - suffix);
  const [keptLeft, keptRight] = commonTokens(leftMiddle, rightMiddle);
  const changedIn = (middle: string[], kept: Set<number>) =>
    new Set(
      middle
        .map((_, i) => i)
        .filter((i) => !kept.has(i))
        .map((i) => i + prefix),
    );
  const removed = ranges(left, changedIn(leftMiddle, keptLeft));
  const added = ranges(right, changedIn(rightMiddle, keptRight));
  const total = Math.max(
    Array.from(oldText).length + Array.from(newText).length,
    1,
  );
  const shared = 1 - (span(removed) + span(added)) / total;
  return shared >= MIN_SHARED ? { removed, added } : null;
}
