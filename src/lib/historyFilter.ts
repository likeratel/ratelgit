/**
 * Which refs a project's history is limited to. An empty list shows every branch, remote and
 * tag. `HEAD` stands for the selected worktree's checked-out commit ("current branch only").
 */

export const HEAD_FILTER = "HEAD";

export type HistoryFilter = readonly string[];

const unique = (refs: readonly string[]) => [...new Set(refs)];

export function isCurrentBranchOnly(filter: HistoryFilter): boolean {
  return filter.length === 1 && filter[0] === HEAD_FILTER;
}

/** Turns a branch, or every branch in a folder, on or off. A folder that is fully on turns
 * off. `HEAD` ("Current branch") stays in the filter and keeps following checkouts. */
export function toggleRefs(
  filter: HistoryFilter,
  ids: readonly string[],
): string[] {
  const base = [...filter];
  const allOn = ids.length > 0 && ids.every((id) => base.includes(id));
  return allOn
    ? base.filter((ref) => !ids.includes(ref))
    : unique([...base, ...ids]);
}

export function removeRef(filter: HistoryFilter, id: string): string[] {
  return filter.filter((ref) => ref !== id);
}

export function toggleCurrentBranch(filter: HistoryFilter): string[] {
  return isCurrentBranchOnly(filter) ? [] : [HEAD_FILTER];
}

export function renameRef(
  filter: HistoryFilter,
  from: string,
  to: string,
): string[] {
  return filter.includes(from)
    ? unique(filter.map((ref) => (ref === from ? to : ref)))
    : [...filter];
}

/** Drops refs that no longer exist, for example after a branch was deleted. */
export function pruneFilter(
  filter: HistoryFilter,
  existing: readonly { id: string }[],
): string[] {
  const ids = new Set(existing.map((ref) => ref.id));
  return filter.filter((ref) => ref === HEAD_FILTER || ids.has(ref));
}

export function sameFilter(a: HistoryFilter, b: HistoryFilter): boolean {
  return a.length === b.length && a.every((ref) => b.includes(ref));
}
