import { EyeOff, ListFilter, X } from "lucide-react";
import { HEAD_FILTER } from "../../lib/historyFilter";
import { useApp } from "../../state/context";
import { activeFilter, activeWorktree } from "../../state/helpers";

/** Shows which refs the history is limited to, with a way back to every branch. */
export function FilterBar() {
  const filter = useApp(activeFilter);
  const references = useApp((s) => s.references);
  const headHidden = useApp((s) => s.history.headHidden);
  const tree = useApp(activeWorktree);
  const remove = useApp((s) => s.removeFromFilter);
  const clear = useApp((s) => s.clearFilter);
  if (filter.length === 0) return null;
  const name = (id: string) =>
    id === HEAD_FILTER
      ? `Current branch (${tree?.branch ?? "HEAD"})`
      : (references.find((r) => r.id === id)?.name ??
        id.replace(/^refs\/(heads|remotes|tags)\//, ""));
  return (
    <div className="filter-bar" data-testid="filter-bar">
      <ListFilter size={14} className="filter-icon" />
      <span className="filter-label">Showing</span>
      <div className="filter-chips">
        {filter.map((id) => (
          <span key={id} className="filter-chip">
            <span className="truncate">{name(id)}</span>
            <button
              type="button"
              aria-label={`Remove ${name(id)} from filter`}
              onClick={() => remove(id)}
            >
              <X size={11} strokeWidth={2.5} />
            </button>
          </span>
        ))}
      </div>
      {headHidden ? (
        <span
          className="head-hidden"
          title="The commit this worktree has checked out is not on the filtered branches."
        >
          <EyeOff size={13} /> HEAD not shown
        </span>
      ) : null}
      <button type="button" className="button small" onClick={clear}>
        Show All Branches
      </button>
    </div>
  );
}
