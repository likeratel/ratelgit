import type { Bridge } from "../bridge";
import { clearedWorkspace, describe, projectOf, samePath } from "./helpers";
import type { Tokens } from "./tokens";
import type {
  AppState,
  GetState,
  Operations,
  ProjectView,
  SetState,
} from "./types";

type ProjectOps = Pick<
  Operations,
  | "init"
  | "loadProjects"
  | "addProject"
  | "removeProject"
  | "selectProject"
  | "selectWorktree"
  | "moveWorktree"
  | "refresh"
>;

const loadingProject = (path: string): ProjectView => ({
  path,
  name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
  state: "loading",
  reason: null,
  worktrees: [],
});

function firstAvailable(
  projects: readonly ProjectView[],
  preferred: string | null,
) {
  const trees = projects
    .filter((p) => p.state === "ready")
    .flatMap((p) => p.worktrees);
  const usable = trees.filter((t) => !t.unavailable);
  return usable.find((t) => t.path === preferred) ?? usable[0] ?? null;
}

export function projectOperations(
  set: SetState,
  get: GetState,
  bridge: Bridge,
  tokens: Tokens,
  reload: () => Promise<void>,
  persist: () => void,
): ProjectOps {
  const selectWorktree = (path: string) => {
    const state = get();
    if (state.mutation) return;
    const project = projectOf(state.projects, path);
    const tree = project?.worktrees.find((t) => t.path === path);
    if (!project || !tree || tree.unavailable) return;
    tokens.next("history");
    tokens.next("changes");
    set({
      activePath: path,
      projectPath: project.path,
      ...clearedWorkspace(),
      ui: { ...state.ui, lastWorktree: path },
    });
    persist();
    void reload();
  };

  const loadProjects = async () => {
    try {
      const projects = await bridge.listProjects();
      const state = get();
      set({ projects });
      if (!state.activePath || !projectOf(projects, state.activePath)) {
        const next = firstAvailable(projects, state.ui.lastWorktree);
        if (next) selectWorktree(next.path);
      }
    } catch (error) {
      set({ error: describe("Reading projects", error) });
    }
  };

  let started = false;
  return {
    async init() {
      if (started) return;
      started = true;
      try {
        const bootstrap = await bridge.getBootstrap();
        const { preferences } = bootstrap;
        set({
          ready: true,
          platform: bootstrap.platform,
          ui: preferences.ui,
          filters: preferences.filters,
          projects: preferences.projects.map(loadingProject),
        });
      } catch (error) {
        set({ ready: true, error: describe("Starting", error) });
        return;
      }
      await loadProjects();
    },

    loadProjects,

    async addProject() {
      if (get().mutation) return;
      try {
        const added = await bridge.addProject();
        if (!added) return;
        set({ projects: added.projects });
        const target =
          added.worktree ?? firstAvailable(added.projects, null)?.path;
        if (target) selectWorktree(target);
      } catch (error) {
        set({ error: describe("Adding the repository", error) });
      }
    },

    async removeProject(path) {
      const state = get();
      if (state.mutation) return;
      try {
        await bridge.removeProject(path);
      } catch (error) {
        set({ error: describe("Removing the project", error) });
        return;
      }
      const projects = get().projects.filter((p) => p.path !== path);
      const filters = Object.fromEntries(
        Object.entries(get().filters).filter(([key]) => key !== path),
      );
      const wasActive = get().projectPath === path;
      set({
        projects,
        filters,
        ...(wasActive
          ? { activePath: null, projectPath: null, ...clearedWorkspace() }
          : {}),
      });
      if (wasActive) tokens.next("workspace");
      persist();
    },

    selectProject(path) {
      const project = get().projects.find((p) => p.path === path);
      const tree = project?.worktrees.find((t) => !t.unavailable);
      if (tree) selectWorktree(tree.path);
    },

    selectWorktree,

    moveWorktree(offset) {
      const state: AppState = get();
      const project = state.projects.find((p) => p.path === state.projectPath);
      const available = (project?.worktrees ?? []).filter(
        (t) => !t.unavailable,
      );
      const index = available.findIndex(
        (t) =>
          state.activePath !== null &&
          samePath(t.path, state.activePath, state.platform),
      );
      if (index < 0 || available.length < 2) return;
      selectWorktree(
        available[(index + offset + available.length) % available.length].path,
      );
    },

    refresh() {
      void loadProjects();
      if (get().activePath && !get().mutation) void reload();
    },
  };
}
