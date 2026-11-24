/** Entries of the quick switcher: projects, worktrees of every project, and branches. */

import type { Reference } from "../bridge/types";
import { fuzzyRank } from "./fuzzy";

export type SwitcherTarget =
  | { kind: "project"; path: string }
  | { kind: "worktree"; path: string }
  | { kind: "branch"; id: string };

export interface SwitcherItem {
  id: string;
  title: string;
  detail: string;
  icon: "project" | "worktree" | "local" | "remote";
  target: SwitcherTarget;
}

interface ProjectLike {
  path: string;
  name: string;
  state: string;
  worktrees: {
    path: string;
    name: string;
    branch: string | null;
    unavailable: boolean;
  }[];
}

export const SWITCHER_LIMIT = 60;

export function switcherItems(
  projects: readonly ProjectLike[],
  references: readonly Reference[],
): SwitcherItem[] {
  const ready = projects.filter((p) => p.state === "ready");
  const projectItems = ready.map<SwitcherItem>((p) => ({
    id: `project:${p.path}`,
    title: p.name,
    detail: `Project · ${p.path}`,
    icon: "project",
    target: { kind: "project", path: p.path },
  }));
  const trees = ready.flatMap((p) =>
    p.worktrees
      .filter((t) => !t.unavailable)
      .map<SwitcherItem>((t) => ({
        id: `worktree:${t.path}`,
        title: t.name,
        detail: `Worktree · ${p.name} · ${t.branch ?? "Detached HEAD"}`,
        icon: "worktree",
        target: { kind: "worktree", path: t.path },
      })),
  );
  const branches = references
    .filter((r) => r.kind === "local" || r.kind === "remote")
    .map<SwitcherItem>((r) => ({
      id: `branch:${r.id}`,
      title: r.name,
      detail: `${r.kind === "local" ? "Branch" : "Remote branch"} · show its history`,
      icon: r.kind === "local" ? "local" : "remote",
      target: { kind: "branch", id: r.id },
    }));
  return [...projectItems, ...trees, ...branches];
}

export function matchSwitcher(
  items: readonly SwitcherItem[],
  query: string,
): SwitcherItem[] {
  const ranked = query.trim()
    ? fuzzyRank(items, query, (item) => item.title)
    : items;
  return ranked.slice(0, SWITCHER_LIMIT);
}
