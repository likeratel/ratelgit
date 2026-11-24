import {
  Archive,
  ChevronRight,
  CircleCheck,
  Folder,
  GitBranch,
  Globe,
  ListFilter,
  SquareStack,
  Tag,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { RefKind, Reference } from "../../bridge";
import {
  buildBranchTree,
  refsBelow,
  type BranchNode,
} from "../../lib/branchTree";
import { baseName } from "../../lib/paths";
import { useApp, useAppStore } from "../../state/context";
import { activeFilter } from "../../state/helpers";
import { useContextMenu } from "../../ui/menu";
import { referenceMenu } from "./refMenu";

const SECTIONS: { kind: RefKind; title: string }[] = [
  { kind: "local", title: "Branches" },
  { kind: "remote", title: "Remotes" },
  { kind: "tag", title: "Tags" },
  { kind: "stash", title: "Stashes" },
];

const INDENT = 14;
const BASE_INDENT = 8;

function FilterToggle({
  on,
  title,
  onToggle,
}: {
  on: boolean;
  title: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`icon-button filter-toggle${on ? " on" : ""}`}
      title={on ? "Remove from the history filter" : title}
      aria-label={on ? "Remove from history filter" : "Add to history filter"}
      aria-pressed={on}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <ListFilter size={13} />
    </button>
  );
}

function refIcon(reference: Reference): ReactNode {
  switch (reference.kind) {
    case "local":
      return reference.isHead ? (
        <CircleCheck size={14} className="row-icon accent" />
      ) : (
        <GitBranch size={14} className="row-icon" />
      );
    case "remote":
      return <GitBranch size={14} className="row-icon" />;
    case "tag":
      return <Tag size={13} className="row-icon" />;
    case "stash":
      return <Archive size={13} className="row-icon" />;
  }
}

function RefRow({
  reference,
  title,
  depth,
}: {
  reference: Reference;
  title: string;
  depth: number;
}) {
  const store = useAppStore();
  const filter = useApp((s) => activeFilter(s));
  const activePath = useApp((s) => s.activePath);
  const reveal = useApp((s) => s.reveal);
  const toggleFilter = useApp((s) => s.toggleFilter);
  const openMenu = useContextMenu();
  const elsewhere =
    reference.worktreePath && reference.worktreePath !== activePath
      ? reference.worktreePath
      : null;
  const on = filter.includes(reference.id);
  return (
    <div
      role="treeitem"
      tabIndex={0}
      className={`sidebar-row ref-row ${reference.kind}${reference.isHead ? " head" : ""}${on ? " filtered" : ""}`}
      style={{ paddingLeft: BASE_INDENT + depth * INDENT + 14 }}
      title={
        reference.isHead
          ? `${reference.name} — checked out in this worktree`
          : (reference.subject ?? reference.name)
      }
      data-testid="ref-row"
      data-ref={reference.id}
      onClick={() => reveal(reference)}
      onKeyDown={(event) => event.key === "Enter" && reveal(reference)}
      onContextMenu={(event) =>
        openMenu(event, referenceMenu(reference, store.getState()))
      }
    >
      {refIcon(reference)}
      <span className="truncate ref-name">{title}</span>
      {reference.kind === "stash" && reference.subject ? (
        <span className="truncate faint small-text ref-subject">
          {reference.subject}
        </span>
      ) : null}
      <span className="row-trailing">
        {elsewhere ? (
          <span
            className="elsewhere"
            title={`Checked out in worktree “${baseName(elsewhere)}” at ${elsewhere}`}
          >
            <SquareStack size={12} />
          </span>
        ) : null}
        {reference.kind !== "stash" ? (
          <FilterToggle
            on={on}
            title={`Show only commits reachable from ${reference.name}`}
            onToggle={() => toggleFilter([reference.id])}
          />
        ) : null}
      </span>
    </div>
  );
}

interface TreeProps {
  nodes: BranchNode<Reference>[];
  depth: number;
  isOpen: (node: BranchNode<Reference>) => boolean;
  toggle: (node: BranchNode<Reference>, open: boolean) => void;
}

function FolderRow({
  node,
  depth,
  open,
  onToggle,
}: {
  node: BranchNode<Reference>;
  depth: number;
  open: boolean;
  onToggle: () => void;
}) {
  const filter = useApp((s) => activeFilter(s));
  const toggleFilter = useApp((s) => s.toggleFilter);
  const openMenu = useContextMenu();
  const refs = refsBelow(node);
  const on = refs.length > 0 && refs.every((r) => filter.includes(r.id));
  const remoteRoot = refs[0]?.kind === "remote" && depth === 0;
  const ids = refs.map((r) => r.id);
  return (
    <div
      role="treeitem"
      aria-expanded={open}
      tabIndex={0}
      className={`sidebar-row folder-row${on ? " filtered" : ""}`}
      style={{ paddingLeft: BASE_INDENT + depth * INDENT }}
      onClick={onToggle}
      onKeyDown={(event) => event.key === "Enter" && onToggle()}
      onContextMenu={(event) =>
        openMenu(event, [
          {
            label: on
              ? "Remove Folder from History Filter"
              : `Show Branches in “${node.path}”`,
            onSelect: () => toggleFilter(ids),
          },
        ])
      }
    >
      <ChevronRight size={12} className={open ? "chevron open" : "chevron"} />
      {remoteRoot ? (
        <Globe size={14} className="row-icon" />
      ) : (
        <Folder size={14} className="row-icon" />
      )}
      <span className="truncate ref-name">{node.name}</span>
      <span className="row-trailing">
        <FilterToggle
          on={on}
          title={`Show only commits on branches in ${node.path}`}
          onToggle={() => toggleFilter(ids)}
        />
      </span>
    </div>
  );
}

function TreeRows({ nodes, depth, isOpen, toggle }: TreeProps) {
  return (
    <>
      {nodes.map((node) => {
        if (node.children.length === 0) {
          return node.reference ? (
            <RefRow
              key={node.id}
              reference={node.reference}
              title={node.name}
              depth={depth}
            />
          ) : null;
        }
        const open = isOpen(node);
        return (
          <div key={node.id} role="group">
            <FolderRow
              node={node}
              depth={depth}
              open={open}
              onToggle={() => toggle(node, !open)}
            />
            {open ? (
              <>
                {node.reference ? (
                  <RefRow
                    reference={node.reference}
                    title={node.name}
                    depth={depth + 1}
                  />
                ) : null}
                <TreeRows
                  nodes={node.children}
                  depth={depth + 1}
                  isOpen={isOpen}
                  toggle={toggle}
                />
              </>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function Section({ kind, title }: { kind: RefKind; title: string }) {
  const references = useApp((s) => s.references);
  const loading = useApp((s) => s.loading);
  const filter = useApp((s) => activeFilter(s));
  const [closed, setClosed] = useState(kind === "tag");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const refs = useMemo(
    () => references.filter((r) => r.kind === kind),
    [references, kind],
  );
  const tree = useMemo(() => buildBranchTree(refs), [refs]);

  // Local folders and remote names start open, as do folders holding HEAD or a filtered branch.
  const isOpen = (node: BranchNode<Reference>) => {
    const set = overrides[node.id];
    if (set !== undefined) return set;
    const below = refsBelow(node);
    return (
      below.some((r) => r.isHead || filter.includes(r.id)) ||
      kind === "local" ||
      !node.path.includes("/")
    );
  };
  const toggle = (node: BranchNode<Reference>, open: boolean) =>
    setOverrides((current) => ({ ...current, [node.id]: open }));

  return (
    <div className="ref-section" role="group" aria-label={title}>
      <button
        type="button"
        className="ref-section-header"
        aria-expanded={!closed}
        onClick={() => setClosed(!closed)}
      >
        <ChevronRight
          size={12}
          className={closed ? "chevron" : "chevron open"}
        />
        <span>{title}</span>
        {refs.length ? (
          <span className="faint tabular">{refs.length}</span>
        ) : null}
      </button>
      {closed ? null : refs.length === 0 ? (
        <p className="sidebar-note indent">{loading ? "Loading…" : "None"}</p>
      ) : kind === "local" || kind === "remote" ? (
        <TreeRows nodes={tree} depth={0} isOpen={isOpen} toggle={toggle} />
      ) : (
        refs.map((ref) => (
          <RefRow key={ref.id} reference={ref} title={ref.name} depth={0} />
        ))
      )}
    </div>
  );
}

export function RefList() {
  const project = useApp((s) =>
    s.projects.find((p) => p.path === s.projectPath),
  );
  const filtered = useApp((s) => activeFilter(s).length > 0);
  const hasWorktree = useApp((s) => s.activePath !== null);
  if (!hasWorktree) return null;
  return (
    <section className="sidebar-section refs" aria-label="Branches and tags">
      <header className="sidebar-header">
        <span className="truncate">{project?.name ?? "References"}</span>
        {filtered ? (
          <span className="filter-indicator" title="History is filtered">
            <ListFilter size={13} />
          </span>
        ) : null}
      </header>
      <div className="sidebar-scroll" role="tree">
        {SECTIONS.map((section) => (
          <Section
            key={section.kind}
            kind={section.kind}
            title={section.title}
          />
        ))}
      </div>
    </section>
  );
}
