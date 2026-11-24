import {
  errorMessage,
  type ChangedFile,
  type Project,
  type Worktree,
} from "../bridge";
import type { AppState, Data, ProjectView } from "./types";

export const EMPTY_HISTORY = {
  lines: [],
  complete: true,
  headHidden: false,
  token: 0,
};

/** Workspace fields cleared when another worktree is selected. */
export function clearedWorkspace(): Partial<Data> {
  return {
    references: [],
    defaultFilter: INITIAL_DEFAULT_FILTER,
    history: EMPTY_HISTORY,
    files: [],
    tracking: null,
    operation: null,
    loadingPage: false,
    commit: null,
    historyFile: null,
    changesFile: null,
  };
}

/** Before the first snapshot arrives the default filter is at least the current branch. */
export const INITIAL_DEFAULT_FILTER: string[] = ["HEAD"];

/** The project's chosen filter: refs, `[]` for every branch, or `null` for the default. */
export function filterSetting(
  state: Pick<Data, "filters" | "projectPath">,
): string[] | null {
  if (!state.projectPath) return null;
  return state.filters[state.projectPath] ?? null;
}

export function isDefaultFilter(
  state: Pick<Data, "filters" | "projectPath">,
): boolean {
  return filterSetting(state) === null;
}

/** The refs History is limited to now; the default filter when none was chosen. */
export function activeFilter(
  state: Pick<Data, "filters" | "projectPath" | "defaultFilter">,
): string[] {
  return filterSetting(state) ?? state.defaultFilter;
}

export function activeWorktree(
  state: Pick<Data, "projects" | "activePath">,
): Worktree | null {
  for (const project of state.projects) {
    const tree = project.worktrees.find((t) => t.path === state.activePath);
    if (tree) return tree;
  }
  return null;
}

export function projectOf(
  projects: readonly ProjectView[],
  worktree: string,
): ProjectView | null {
  return (
    projects.find((p) => p.worktrees.some((t) => t.path === worktree)) ?? null
  );
}

export function readyProject(project: Project): ProjectView {
  return { ...project };
}

export function describe(label: string, error: unknown): string {
  return `${label} failed. ${errorMessage(error)}`;
}

export const sameFile = (a: ChangedFile, b: ChangedFile) =>
  a.path === b.path && a.kind === b.kind;

/** Path comparison that ignores separators, a trailing slash and (on Windows) case. */
export function samePath(
  a: string,
  b: string,
  platform: AppState["platform"],
): boolean {
  const normalize = (p: string) => {
    const unified = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return platform === "windows" ? unified.toLowerCase() : unified;
  };
  return normalize(a) === normalize(b);
}

/** Monotonic counters that tell the latest request from older ones. */
let counter = 0;
export function nextToken(): number {
  counter += 1;
  return counter;
}
