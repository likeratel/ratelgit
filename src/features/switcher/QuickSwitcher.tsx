import { Folder, GitBranch, Globe, Package, Search } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  matchSwitcher,
  switcherItems,
  type SwitcherItem,
} from "../../lib/switcher";
import { useApp } from "../../state/context";
import { EmptyState } from "../../ui/EmptyState";
import { Modal } from "../../ui/Modal";

const ICONS = {
  project: Package,
  worktree: Folder,
  local: GitBranch,
  remote: Globe,
};

/** ⌘P palette: type to fuzzy-match, ↑↓ to move, Return to go, Esc to close. */
export function QuickSwitcher() {
  const open = useApp((s) => s.switcherOpen);
  return open ? <SwitcherPanel /> : null;
}

function SwitcherPanel() {
  const projects = useApp((s) => s.projects);
  const references = useApp((s) => s.references);
  const setOpen = useApp((s) => s.setSwitcherOpen);
  const selectProject = useApp((s) => s.selectProject);
  const selectWorktree = useApp((s) => s.selectWorktree);
  const filterTo = useApp((s) => s.filterTo);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const items = useMemo(
    () => matchSwitcher(switcherItems(projects, references), query),
    [projects, references, query],
  );

  const choose = (item: SwitcherItem | undefined) => {
    if (!item) return;
    setOpen(false);
    if (item.target.kind === "project") selectProject(item.target.path);
    if (item.target.kind === "worktree") selectWorktree(item.target.path);
    if (item.target.kind === "branch") filterTo(item.target.id);
  };

  const move = (step: number) => {
    const next = Math.min(Math.max(highlighted + step, 0), items.length - 1);
    setHighlighted(next);
    list.current?.children[next]?.scrollIntoView({ block: "nearest" });
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (event.key === "Enter") choose(items[highlighted]);
    else return;
    event.preventDefault();
  };

  return (
    <Modal
      label="Quick switcher"
      onClose={() => setOpen(false)}
      className="switcher"
    >
      <label className="switcher-input">
        <Search size={16} />
        <input
          data-autofocus
          value={query}
          placeholder="Jump to a project, worktree or branch"
          aria-label="Jump to a project, worktree or branch"
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlighted(0);
          }}
          onKeyDown={onKey}
        />
      </label>
      <div
        className="switcher-list"
        ref={list}
        role="listbox"
        aria-label="Matches"
      >
        {items.length === 0 ? (
          <EmptyState title="No matches">Nothing matches “{query}”.</EmptyState>
        ) : (
          items.map((item, index) => {
            const Icon = ICONS[item.icon];
            return (
              <div
                key={item.id}
                role="option"
                aria-selected={index === highlighted}
                className={`switcher-item${index === highlighted ? " highlighted" : ""}`}
                onMouseMove={() => setHighlighted(index)}
                onClick={() => choose(item)}
              >
                <Icon size={15} />
                <span className="switcher-text">
                  <span className="truncate">{item.title}</span>
                  <span className="truncate switcher-detail">
                    {item.detail}
                  </span>
                </span>
              </div>
            );
          })
        )}
      </div>
      <div className="switcher-footer">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> move
        </span>
        <span>
          <kbd>↩</kbd> open
        </span>
        <span>
          <kbd>esc</kbd> close
        </span>
      </div>
    </Modal>
  );
}
