import {
  AlertTriangle,
  ChevronRight,
  Folder,
  FolderOpen,
  Package,
  Plus,
} from "lucide-react";
import { useState } from "react";
import type { Worktree } from "../../bridge";
import { formatShortcut, isMac, SHORTCUTS } from "../../lib/shortcuts";
import { useApp } from "../../state/context";
import type { ProjectView } from "../../state/types";
import { useContextMenu } from "../../ui/menu";

function TreeBadges({ tree }: { tree: Worktree }) {
  const ahead = tree.ahead ?? 0;
  const behind = tree.behind ?? 0;
  return (
    <span className="row-trailing">
      {ahead + behind > 0 ? (
        <span
          className="sync-counts tabular"
          title={`${ahead} ahead, ${behind} behind its upstream`}
        >
          {ahead > 0 ? `↑${ahead}` : ""}
          {ahead > 0 && behind > 0 ? " " : ""}
          {behind > 0 ? `↓${behind}` : ""}
        </span>
      ) : null}
      {tree.changes ? (
        <span
          className="count-pill warn"
          title={`${tree.changes} changed ${tree.changes === 1 ? "file" : "files"}`}
        >
          {tree.changes}
        </span>
      ) : null}
    </span>
  );
}

function WorktreeRow({ tree, active }: { tree: Worktree; active: boolean }) {
  const selectWorktree = useApp((s) => s.selectWorktree);
  const Icon = active ? FolderOpen : Folder;
  return (
    <button
      type="button"
      className={`sidebar-row worktree-row${active ? " selected" : ""}`}
      aria-current={active ? "true" : undefined}
      disabled={tree.unavailable}
      title={tree.path}
      data-testid="worktree-row"
      onClick={() => selectWorktree(tree.path)}
    >
      <Icon size={15} className="row-icon accent" />
      <span className="worktree-text">
        <span className="truncate worktree-name">{tree.name}</span>
        <span className="truncate worktree-branch">
          {tree.unavailable ? "Unavailable" : (tree.branch ?? "Detached HEAD")}
        </span>
      </span>
      <TreeBadges tree={tree} />
    </button>
  );
}

function ProjectRow({
  project,
  open,
  toggle,
}: {
  project: ProjectView;
  open: boolean;
  toggle: () => void;
}) {
  const selectProject = useApp((s) => s.selectProject);
  const removeProject = useApp((s) => s.removeProject);
  const busy = useApp((s) => s.mutation !== null);
  const openMenu = useContextMenu();
  const unavailable = project.state === "unavailable";
  return (
    <div
      className={`sidebar-row project-row${unavailable ? " unavailable" : ""}`}
      title={
        project.reason ? `${project.path}\n${project.reason}` : project.path
      }
      onContextMenu={(event) =>
        openMenu(event, [
          {
            label: "Remove from List",
            disabled: busy,
            onSelect: () => void removeProject(project.path),
          },
        ])
      }
    >
      <button
        type="button"
        className="disclosure"
        aria-label={open ? "Collapse" : "Expand"}
        aria-expanded={open}
        onClick={toggle}
      >
        <ChevronRight size={13} className={open ? "chevron open" : "chevron"} />
      </button>
      <button
        type="button"
        className="project-label"
        onClick={() => !unavailable && selectProject(project.path)}
      >
        {unavailable ? (
          <AlertTriangle size={14} className="row-icon warn" />
        ) : (
          <Package size={14} className="row-icon" />
        )}
        <span className="truncate project-name">{project.name}</span>
      </button>
      <span className="row-trailing">
        {project.state === "loading" ? (
          <span className="spinner" aria-label="Loading" />
        ) : null}
        {unavailable ? (
          <span className="faint small-text">
            {project.reason ?? "Unavailable"}
          </span>
        ) : null}
        {project.state === "ready" && project.worktrees.length > 1 ? (
          <span className="faint small-text tabular">
            {project.worktrees.length}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function ProjectList() {
  const projects = useApp((s) => s.projects);
  const activePath = useApp((s) => s.activePath);
  const addProject = useApp((s) => s.addProject);
  const platform = useApp((s) => s.platform);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <section className="sidebar-section projects" aria-label="Projects">
      <header className="sidebar-header">
        <span>Projects</span>
        <button
          type="button"
          className="icon-button"
          title={`Add a repository (${formatShortcut(SHORTCUTS.openRepository, isMac(platform))})`}
          aria-label="Add Repository"
          onClick={() => void addProject()}
        >
          <Plus size={15} />
        </button>
      </header>
      <div className="sidebar-scroll" role="tree">
        {projects.length === 0 ? (
          <p className="sidebar-note">
            No projects yet. Add a repository to get started.
          </p>
        ) : null}
        {projects.map((project) => {
          const open = !collapsed.has(project.path);
          return (
            <div key={project.path} role="treeitem" aria-expanded={open}>
              <ProjectRow
                project={project}
                open={open}
                toggle={() => toggle(project.path)}
              />
              {open
                ? project.worktrees.map((tree) => (
                    <WorktreeRow
                      key={tree.path}
                      tree={tree}
                      active={tree.path === activePath}
                    />
                  ))
                : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
