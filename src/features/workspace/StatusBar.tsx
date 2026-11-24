import { CircleAlert, Folder, Info, X } from "lucide-react";
import { plural } from "../../lib/format";
import { useApp } from "../../state/context";
import { activeWorktree } from "../../state/helpers";

export function ErrorBar() {
  const error = useApp((s) => s.error);
  const dismiss = useApp((s) => s.dismissError);
  if (!error) return null;
  return (
    <div className="error-bar" role="alert">
      <CircleAlert size={15} />
      <span className="selectable error-text">{error}</span>
      <button
        type="button"
        className="icon-button"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function NoticeBar() {
  const notice = useApp((s) => s.notice);
  const dismiss = useApp((s) => s.dismissNotice);
  if (!notice) return null;
  return (
    <div className="notice-bar" role="status">
      <Info size={15} />
      <span className="error-text">{notice}</span>
      <button
        type="button"
        className="icon-button"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function StatusBar() {
  const tree = useApp(activeWorktree);
  const mutation = useApp((s) => s.mutation);
  const loading = useApp((s) => s.loading || s.loadingPage);
  const count = useApp((s) => s.history.lines.length);
  const complete = useApp((s) => s.history.complete);
  return (
    <footer className="status-bar">
      <Folder size={12} />
      <span className="truncate selectable">
        {tree?.path ?? "No worktree selected"}
      </span>
      <span className="status-right">
        {mutation ? (
          <>
            <span className="spinner" /> {mutation}…
          </>
        ) : loading ? (
          <>
            <span className="spinner" /> Loading…
          </>
        ) : tree ? (
          <span className="tabular">
            {complete
              ? plural(count, "commit")
              : `${plural(count, "commit")} loaded, more below`}
          </span>
        ) : null}
      </span>
    </footer>
  );
}
