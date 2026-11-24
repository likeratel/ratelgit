import { EyeOff, ListFilter, RotateCcw, X } from "lucide-react";
import { HEAD_FILTER } from "../../lib/historyFilter";
import { useApp } from "../../state/context";
import {
  activeFilter,
  activeWorktree,
  isDefaultFilter,
} from "../../state/helpers";

const shortName = (id: string) =>
  id.replace(/^refs\/(heads|remotes|tags)\//, "");

/**
 * Always shown above the history: which refs it is limited to, with "Show All" (every
 * branch) and "Default" (current branch plus origin/main or origin/master).
 */
export function FilterBar() {
  const filter = useApp(activeFilter);
  const isDefault = useApp(isDefaultFilter);
  const references = useApp((s) => s.references);
  const headHidden = useApp((s) => s.history.headHidden);
  const tree = useApp(activeWorktree);
  const busy = useApp((s) => s.mutation !== null);
  const remove = useApp((s) => s.removeFromFilter);
  const showAll = useApp((s) => s.clearFilter);
  const reset = useApp((s) => s.resetFilter);
  const name = (id: string) =>
    id === HEAD_FILTER
      ? `Current branch · ${tree?.branch ?? "detached HEAD"}`
      : (references.find((r) => r.id === id)?.name ?? shortName(id));
  const all = filter.length === 0;
  return (
    <div className={`filter-bar${all ? " all" : ""}`} data-testid="filter-bar">
      <ListFilter size={14} className="filter-icon" />
      <span className="filter-label">
        {all ? "All branches" : isDefault ? "Default" : "Showing"}
      </span>
      <div className="filter-chips" title={filter.map(name).join(", ")}>
        {filter.map((id) => (
          <span
            key={id}
            className={`filter-chip${id === HEAD_FILTER ? " head" : ""}`}
          >
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
      <div className="filter-actions">
        <button
          type="button"
          className="button small"
          disabled={all || busy}
          title="Show every branch, remote branch and tag"
          aria-label="Show All: remove every filter and show all branches"
          onClick={showAll}
        >
          Show All
        </button>
        <button
          type="button"
          className="button small"
          disabled={isDefault || busy}
          title="Go back to the default filter: the current branch plus origin/main or origin/master"
          aria-label="Default: show the current branch plus origin/main or origin/master"
          onClick={reset}
        >
          <RotateCcw size={12} /> Default
        </button>
      </div>
    </div>
  );
}
