/** Subsequence matching for the quick switcher. Higher scores rank first; null means no match. */

const MATCH = 1;
const CONSECUTIVE = 6;
const BOUNDARY = 8;
const PREFIX = 25;
const SUBSTRING = 15;
const MAX_GAP_PENALTY = 4;
const SEPARATORS = new Set(["/", "-", "_", " ", ".", "@"]);

const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase();
const isLower = (c: string) => c !== c.toUpperCase() && c === c.toLowerCase();

function isBoundary(index: number, text: string[]): boolean {
  if (index === 0) return true;
  const before = text[index - 1];
  return SEPARATORS.has(before) || (isLower(before) && isUpper(text[index]));
}

function walk(
  needle: string[],
  haystack: string[],
  original: string[],
  start: number,
): number | null {
  let total = 0;
  let previous = -1;
  let position = start;
  for (const character of needle) {
    const found = haystack.indexOf(character, position);
    if (found < 0) return null;
    total += MATCH;
    if (previous >= 0) {
      if (found === previous + 1) total += CONSECUTIVE;
      total -= Math.min(found - previous - 1, MAX_GAP_PENALTY);
    }
    if (isBoundary(found, original)) total += BOUNDARY;
    previous = found;
    position = found + 1;
  }
  return total;
}

/** The query appears as one piece starting at a word start, such as `login` in `fix/login`. */
function atBoundary(
  needle: string[],
  haystack: string[],
  original: string[],
): boolean {
  const query = needle.join("");
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (
      isBoundary(start, original) &&
      haystack.slice(start, start + needle.length).join("") === query
    ) {
      return true;
    }
  }
  return false;
}

export function fuzzyScore(query: string, candidate: string): number | null {
  const needle = Array.from(query.toLowerCase().replace(/\s+/gu, ""));
  if (needle.length === 0) return 0;
  const original = Array.from(candidate);
  const haystack = Array.from(candidate.toLowerCase());
  if (original.length !== haystack.length) {
    return candidate.toLowerCase().includes(query.toLowerCase())
      ? SUBSTRING
      : null;
  }
  const scores = haystack
    .map((character, index) =>
      character === needle[0] ? walk(needle, haystack, original, index) : null,
    )
    .filter((score): score is number => score !== null);
  if (scores.length === 0) return null;
  const best = Math.max(...scores);
  const prefix = haystack.slice(0, needle.length).join("") === needle.join("");
  return (
    best +
    (prefix ? PREFIX : 0) +
    (atBoundary(needle, haystack, original) ? SUBSTRING : 0)
  );
}

/** Ranks items by score, keeping the original order for ties. */
export function fuzzyRank<T>(
  items: readonly T[],
  query: string,
  text: (item: T) => string,
): T[] {
  return items
    .map((item, offset) => ({
      item,
      offset,
      score: fuzzyScore(query, text(item)),
    }))
    .filter(
      (entry): entry is { item: T; offset: number; score: number } =>
        entry.score !== null,
    )
    .sort((a, b) =>
      a.score === b.score ? a.offset - b.offset : b.score - a.score,
    )
    .map((entry) => entry.item);
}
