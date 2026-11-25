/** Adding and removing worktrees in the fake core, checked like the real one. */

import { BridgeError } from "../bridge";
import type {
  Action,
  RemovalPreview,
  RemovalResult,
  RemoveOptions,
  WorktreePlan,
} from "../types";
import {
  findTree,
  type FakeProject,
  type FakeTree,
  type FakeWorld,
} from "./world";

const TREES_PARENT = "/work/trees";
const invalid = (message: string) => new BridgeError("invalid_input", message);

function projectOf(world: FakeWorld, worktree: string): FakeProject {
  return findTree(world, worktree)[0];
}

function folderPath(parent: string | null, folder: string): string {
  return `${parent ? TREES_PARENT : "/work"}/${folder.trim()}`;
}

function folderError(
  world: FakeWorld,
  path: string,
  folder: string,
): string | null {
  const name = folder.trim();
  if (
    !name ||
    name === "." ||
    name === ".." ||
    /[\\/:]/.test(name) ||
    name.startsWith("-")
  ) {
    return "Enter a folder name without slashes for the new worktree.";
  }
  const taken = world.projects.some((p) =>
    p.trees.some((t) => t.path === path),
  );
  return taken
    ? "A folder with this name already exists and is not empty."
    : null;
}

function branchError(project: FakeProject, name: string): string | null {
  const valid =
    name &&
    !/(\.\.|\s|~|\^|:|\?|\*|\[|\\)/.test(name) &&
    !name.startsWith("-") &&
    !name.endsWith(".lock") &&
    !name.endsWith("/");
  if (!valid) return `“${name}” is not a valid branch name.`;
  return project.refs.some((r) => r.id === `refs/heads/${name}`)
    ? `A branch named “${name}” already exists.`
    : null;
}

export function planWorktree(
  world: FakeWorld,
  worktree: string,
  parent: string | null,
  folder: string,
  newBranch: string | null,
): WorktreePlan {
  const project = projectOf(world, worktree);
  const path = folderPath(parent, folder);
  const folderProblem = folderError(world, path, folder);
  return {
    path: folderProblem?.startsWith("Enter") ? null : path,
    folderError: folderProblem,
    branchError: newBranch === null ? null : branchError(project, newBranch),
  };
}

/** The branch name, start commit and new local ref (if any) of an addWorktree action. */
function resolveBranch(
  project: FakeProject,
  action: Extract<Action, { type: "addWorktree" }>,
  path: string,
) {
  const { branch } = action;
  const target = (id: string) =>
    project.refs.find((r) => r.id === id)?.target ?? null;
  if (branch.type === "new") {
    const problem = branchError(project, branch.name);
    if (problem) throw invalid(problem);
    const start =
      branch.startPoint === "HEAD"
        ? project.trees[0].head
        : target(branch.startPoint);
    if (!start) throw invalid("The start point does not exist.");
    return { name: branch.name, head: start, created: true };
  }
  const ref = project.refs.find((r) => r.id === branch.reference);
  if (!ref?.target)
    throw new BridgeError("git_failed", "fatal: invalid reference");
  if (branch.type === "existing") {
    if (ref.worktreePath)
      throw new BridgeError(
        "git_failed",
        `fatal: '${ref.name}' is already used by worktree at '${ref.worktreePath}'`,
      );
    return { name: ref.name, head: ref.target, created: false };
  }
  const name = ref.name.replace(/^[^/]+\//, "");
  const problem = branchError(project, name);
  if (problem) throw invalid(problem);
  void path;
  return { name, head: ref.target, created: true };
}

export function addWorktree(
  world: FakeWorld,
  worktree: string,
  action: Extract<Action, { type: "addWorktree" }>,
): FakeWorld {
  const project = projectOf(world, worktree);
  const path = folderPath(action.parent, action.folder);
  const problem = folderError(world, path, action.folder);
  if (problem) throw invalid(problem);
  const { name, head, created } = resolveBranch(project, action, path);
  const tree: FakeTree = {
    path,
    branch: name,
    head,
    files: [],
    tracking: null,
    operation: null,
  };
  const id = `refs/heads/${name}`;
  const refs = created
    ? [
        ...project.refs,
        {
          id,
          name,
          kind: "local" as const,
          target: head,
          isHead: false,
          worktreePath: path,
          subject: null,
        },
      ]
    : project.refs.map((r) => (r.id === id ? { ...r, worktreePath: path } : r));
  return {
    ...world,
    projects: world.projects.map((p) =>
      p.path === project.path ? { ...p, refs, trees: [...p.trees, tree] } : p,
    ),
  };
}

/** As in the core: an upstream with another name, or a remote default, is never deleted. */
function remoteBlock(
  branch: string | null,
  upstream: { remote: string; name: string } | null,
): string | null {
  if (!branch || !upstream) return null;
  const full = `${upstream.remote}/${upstream.name}`;
  if (upstream.name !== branch) {
    return `Its upstream is ${full}, a branch with another name, so it is kept.`;
  }
  return ["main", "master"].includes(upstream.name)
    ? `${full} is the remote's default branch, so it is kept.`
    : null;
}

export function removalPreview(
  world: FakeWorld,
  worktree: string,
  target: string,
): RemovalPreview {
  const project = projectOf(world, worktree);
  const index = project.trees.findIndex((t) => t.path === target);
  if (index < 0)
    throw new BridgeError(
      "not_found",
      "This folder is not a worktree of the project.",
    );
  const tree = project.trees[index];
  const upstream = tree.tracking
    ? {
        remote: tree.tracking.remote,
        name: tree.tracking.target.replace(/^refs\/heads\//, ""),
      }
    : null;
  const changed = new Set(
    tree.files.filter((f) => f.kind !== "untracked").map((f) => f.path),
  );
  const others = project.trees.filter(
    (t, i) => i !== index && t.branch === tree.branch,
  );
  const blocked =
    tree.branch === "main"
      ? `“${tree.branch}” is the project's default branch.`
      : others.length
        ? `“${tree.branch}” is also checked out in ${others[0].path}.`
        : null;
  return {
    path: tree.path,
    branch: tree.branch,
    isMain: index === 0,
    prunable: false,
    locked: null,
    operation: tree.operation?.kind ?? null,
    changes: changed.size,
    untracked: tree.files.filter((f) => f.kind === "untracked").length,
    unmergedCommits: tree.branch === "fix/login-redirect" ? 1 : 0,
    // The dark-mode branch has a commit only origin/feature/ui/dark-mode also has.
    unmergedWithRemote:
      tree.branch === "fix/login-redirect" ||
      tree.branch === "feature/ui/dark-mode"
        ? 1
        : 0,
    ignored: tree.path.endsWith("-login") ? 2 : 0,
    ignoredExamples: tree.path.endsWith("-login")
      ? [".env", "node_modules/"]
      : [],
    submodules: false,
    upstream,
    remoteBlock: remoteBlock(tree.branch, upstream),
    tip: tree.head,
    branchBlock: tree.branch === null ? null : blocked,
  };
}

/** Removes a worktree; `offline` makes the remote branch deletion fail, as without network. */
export function removeWorktree(
  world: FakeWorld,
  worktree: string,
  target: string,
  options: RemoveOptions,
  offline: boolean,
): [FakeWorld, RemovalResult] {
  const preview = removalPreview(world, worktree, target);
  if (preview.isMain)
    throw invalid("The main worktree of a project cannot be removed.");
  // As in the core: more loss than the dialog showed means the consent is out of date.
  const seen = options.seen;
  const lost = options.deleteBranch
    ? options.deleteRemote
      ? preview.unmergedWithRemote
      : preview.unmergedCommits
    : 0;
  const grew =
    preview.changes > seen.changes ||
    preview.untracked > seen.untracked ||
    preview.ignored > seen.ignored ||
    lost > seen.lostCommits ||
    preview.tip !== seen.tip;
  if (grew) {
    throw new BridgeError(
      "stale",
      "The worktree changed since it was checked. Review what would be lost again.",
    );
  }
  if (
    (preview.changes + preview.untracked > 0 || preview.operation) &&
    !options.force
  ) {
    throw invalid(
      "The worktree has changes that would be lost. Confirm to remove it anyway.",
    );
  }
  if (options.deleteBranch && preview.branchBlock)
    throw invalid(`${preview.branchBlock} The branch is kept.`);
  if (
    options.deleteBranch &&
    preview.unmergedCommits > 0 &&
    !options.allowUnmerged
  ) {
    throw invalid(
      "The branch has commits that are on no other branch. Confirm to delete them.",
    );
  }
  const project = projectOf(world, worktree);
  const branchId = `refs/heads/${preview.branch}`;
  const refs = project.refs
    .filter((r) => !(options.deleteBranch && r.id === branchId))
    .map((r) => (r.worktreePath === target ? { ...r, worktreePath: null } : r));
  const next = {
    ...world,
    projects: world.projects.map((p) =>
      p.path === project.path
        ? { ...p, refs, trees: p.trees.filter((t) => t.path !== target) }
        : p,
    ),
  };
  const remote = options.deleteRemote && preview.upstream;
  const result: RemovalResult = {
    branchDeleted: options.deleteBranch ? true : null,
    remoteDeleted: remote ? !offline : null,
    problem:
      remote && offline
        ? `The worktree and the local branch were removed, but deleting the remote branch ${preview.upstream?.remote}/${preview.upstream?.name} failed: fatal: unable to access remote`
        : null,
  };
  return [next, result];
}
