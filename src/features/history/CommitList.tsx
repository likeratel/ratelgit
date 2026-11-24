import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleDashed, GitCommitHorizontal, Search } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { CommitLine } from "../../bridge";
import { graphWidth, layoutGraph, type GraphLayout } from "../../lib/graph";
import { isCurrentBranchOnly } from "../../lib/historyFilter";
import { formatShortcut, isMac, SHORTCUTS } from "../../lib/shortcuts";
import { useApp } from "../../state/context";
import { activeFilter } from "../../state/helpers";
import { EmptyState } from "../../ui/EmptyState";
import { useWidth } from "../../ui/useWidth";
import { Badges } from "./Badges";
import { FilterBar } from "./FilterBar";
import { GRAPH_ROW_HEIGHT, GraphCell } from "./GraphCell";

/** Below these list widths the author and date columns are hidden so messages stay readable. */
const AUTHOR_BREAKPOINT = 720;
const DATE_BREAKPOINT = 560;

type Row =
  | { kind: "uncommitted" }
  | { kind: "commit"; line: CommitLine; index: number }
  | { kind: "more" };

function matches(line: CommitLine, query: string): boolean {
  const needle = query.toLowerCase();
  return [line.subject, line.author, line.hash, line.date, ...line.refs].some(
    (t) => t.toLowerCase().includes(needle),
  );
}

function Columns({
  graph,
  author,
  date,
}: {
  graph: number;
  author: boolean;
  date: boolean;
}) {
  return (
    <div className="commit-columns" role="row">
      <span style={{ width: graph }} />
      <span className="col-subject">Description</span>
      {author ? <span className="col-author">Author</span> : null}
      {date ? <span className="col-date">Date</span> : null}
      <span className="col-hash">Commit</span>
    </div>
  );
}

function Toolbar({
  query,
  setQuery,
}: {
  query: string;
  setQuery: (q: string) => void;
}) {
  const filter = useApp(activeFilter);
  const toggle = useApp((s) => s.toggleCurrentBranchOnly);
  const platform = useApp((s) => s.platform);
  const only = isCurrentBranchOnly(filter);
  return (
    <div className="history-toolbar">
      <label className="search-field">
        <Search size={13} />
        <input
          type="search"
          placeholder="Search loaded commits"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && setQuery("")}
          aria-label="Search loaded commits"
        />
      </label>
      <button
        type="button"
        className={`button small${only ? " toggled" : ""}`}
        aria-pressed={only}
        title={`Show only the checked-out branch (${formatShortcut(SHORTCUTS.currentBranchOnly, isMac(platform))})`}
        onClick={toggle}
      >
        <GitCommitHorizontal size={13} /> Current branch only
      </button>
    </div>
  );
}

function useRows(query: string) {
  const lines = useApp((s) => s.history.lines);
  const complete = useApp((s) => s.history.complete);
  const headHidden = useApp((s) => s.history.headHidden);
  const hasChanges = useApp((s) => s.files.length > 0);
  const layout: GraphLayout = useMemo(() => layoutGraph(lines), [lines]);
  const rows: Row[] = useMemo(() => {
    if (query)
      return lines.flatMap((line, index) =>
        matches(line, query) ? [{ kind: "commit" as const, line, index }] : [],
      );
    return [
      ...(hasChanges && !headHidden ? [{ kind: "uncommitted" as const }] : []),
      ...lines.map((line, index) => ({ kind: "commit" as const, line, index })),
      ...(complete ? [] : [{ kind: "more" as const }]),
    ];
  }, [lines, query, hasChanges, headHidden, complete]);
  return { rows, layout };
}

export function CommitList() {
  const [query, setQuery] = useState("");
  const { rows, layout } = useRows(query);
  const selected = useApp((s) => s.commit?.hash ?? null);
  const selectCommit = useApp((s) => s.selectCommit);
  const setMode = useApp((s) => s.setMode);
  const loadMore = useApp((s) => s.loadMoreHistory);
  const loading = useApp((s) => s.loading);
  const loadingPage = useApp((s) => s.loadingPage);
  const filtered = useApp((s) => activeFilter(s).length > 0);
  const changed = useApp((s) => new Set(s.files.map((f) => f.path)).size);
  const references = useApp((s) => s.references);
  const remotes = useMemo(
    () =>
      new Set(references.filter((r) => r.kind === "remote").map((r) => r.name)),
    [references],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const width = useWidth(scroller);
  const showGraph = !query;
  const graph = showGraph ? graphWidth(layout.columns) : 4;
  const author = width === 0 || width >= AUTHOR_BREAKPOINT;
  const date = width === 0 || width >= DATE_BREAKPOINT;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => GRAPH_ROW_HEIGHT,
    overscan: 16,
  });
  const items = virtualizer.getVirtualItems();
  const last = items.at(-1);

  useEffect(() => {
    if (last && rows[last.index]?.kind === "more") void loadMore();
  }, [last, rows, loadMore]);

  const selectedRow = rows.findIndex(
    (r) => r.kind === "commit" && r.line.hash === selected,
  );
  useEffect(() => {
    if (selectedRow >= 0)
      virtualizer.scrollToIndex(selectedRow, { align: "auto" });
  }, [selectedRow, virtualizer]);

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    for (let i = selectedRow + step; i >= 0 && i < rows.length; i += step) {
      const row = rows[i];
      if (row.kind === "commit") {
        void selectCommit(row.line.hash);
        return;
      }
    }
  };

  const empty = rows.length === 0;
  return (
    <div className="commit-list">
      <Toolbar query={query} setQuery={setQuery} />
      <FilterBar />
      <Columns graph={graph} author={author} date={date} />
      <div
        className="commit-scroll"
        ref={scroller}
        tabIndex={0}
        onKeyDown={onKey}
        role="grid"
        aria-label="Commits"
        data-testid="commit-list"
      >
        {empty ? (
          loading ? (
            <EmptyState title="Reading history…" />
          ) : (
            <EmptyState
              icon={<GitCommitHorizontal size={20} />}
              title={
                query
                  ? "No matching commits"
                  : filtered
                    ? "No commits match the filter"
                    : "No commits yet"
              }
            >
              {query
                ? `Nothing in the loaded history matches “${query}”.`
                : filtered
                  ? "The filtered branches have no commits."
                  : "Commit your first change in Changes."}
            </EmptyState>
          )
        ) : (
          <div
            className="commit-canvas"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {items.map((item) => {
              const row = rows[item.index];
              const style = { transform: `translateY(${item.start}px)` };
              if (row.kind === "uncommitted") {
                return (
                  <button
                    key="uncommitted"
                    type="button"
                    className="commit-row uncommitted"
                    style={style}
                    onClick={() => setMode("changes")}
                    title="Show the working changes of this worktree"
                  >
                    <span className="uncommitted-node" style={{ width: graph }}>
                      <CircleDashed size={11} strokeWidth={3} />
                    </span>
                    <span className="col-subject">
                      Uncommitted changes ({changed})
                    </span>
                  </button>
                );
              }
              if (row.kind === "more") {
                return (
                  <div key="more" className="commit-row more" style={style}>
                    {loadingPage ? <span className="spinner" /> : null}
                    <span className="muted">
                      {loadingPage
                        ? "Loading more commits…"
                        : "More commits below"}
                    </span>
                  </div>
                );
              }
              const { line } = row;
              const head = line.refs.some(
                (r) => r === "HEAD" || r.startsWith("HEAD -> "),
              );
              const isSelected = line.hash === selected;
              return (
                <div
                  key={line.hash}
                  role="row"
                  aria-selected={isSelected}
                  className={`commit-row${isSelected ? " selected" : ""}${head ? " head" : ""}`}
                  style={style}
                  onClick={() => void selectCommit(line.hash)}
                  data-testid="commit-row"
                >
                  {showGraph ? (
                    <GraphCell
                      row={layout.rows[row.index]}
                      columns={layout.columns}
                      merge={line.parents.length > 1}
                    />
                  ) : (
                    <span style={{ width: graph }} />
                  )}
                  <span className="col-subject">
                    <Badges refs={line.refs} remotes={remotes} />
                    <span className="truncate subject" title={line.subject}>
                      {line.subject}
                    </span>
                  </span>
                  {author ? (
                    <span className="col-author truncate">{line.author}</span>
                  ) : null}
                  {date ? (
                    <span className="col-date tabular">{line.date}</span>
                  ) : null}
                  <span className="col-hash mono">{line.shortHash}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
