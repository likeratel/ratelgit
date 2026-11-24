import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Ellipsis,
  GitBranch,
} from "lucide-react";
import { formatShortcut, isMac, SHORTCUTS } from "../../lib/shortcuts";
import { useApp } from "../../state/context";
import { createBranchPrompt, stashPrompt } from "../../state/dialogs";
import { activeWorktree } from "../../state/helpers";
import { useContextMenu } from "../../ui/menu";
import { Segmented } from "../../ui/Segmented";

function Tracking() {
  const tracking = useApp((s) => s.tracking);
  if (!tracking) return <span className="faint">No upstream</span>;
  const upstream = `${tracking.remote}/${tracking.target.replace(/^refs\/heads\//, "")}`;
  return (
    <span className="tracking tabular" title={`Compared with ${upstream}`}>
      <span className={tracking.ahead ? "ahead" : ""}>↑{tracking.ahead}</span>
      <span className={tracking.behind ? "behind" : ""}>
        ↓{tracking.behind}
      </span>
    </span>
  );
}

function RemoteButtons() {
  const execute = useApp((s) => s.execute);
  const tracking = useApp((s) => s.tracking);
  const busy = useApp((s) => s.loading || s.mutation !== null);
  const ask = useApp((s) => s.ask);
  const refresh = useApp((s) => s.refresh);
  const platform = useApp((s) => s.platform);
  const openMenu = useContextMenu();
  const noUpstream = !tracking || tracking.remote === ".";
  const why = noUpstream ? "This branch has no remote upstream" : undefined;
  return (
    <div className="header-actions">
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={() => void execute({ type: "fetch" }, "Fetch")}
        title="Fetch every remote"
      >
        <ArrowDownToLine size={14} /> Fetch
      </button>
      <button
        type="button"
        className="button"
        disabled={busy || noUpstream}
        title={why ?? "Fast-forward from the upstream"}
        onClick={() => void execute({ type: "pull" }, "Pull")}
      >
        <ArrowDown size={14} /> Pull
      </button>
      <button
        type="button"
        className="button"
        disabled={busy || noUpstream}
        title={why ?? "Push to the upstream"}
        onClick={() => void execute({ type: "push" }, "Push")}
      >
        <ArrowUp size={14} /> Push
      </button>
      <button
        type="button"
        className="button"
        aria-label="More actions"
        disabled={busy}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          openMenu({ x: box.right - 220, y: box.bottom + 4 }, [
            { label: "New Branch…", onSelect: () => ask(createBranchPrompt()) },
            { label: "Stash Changes…", onSelect: () => ask(stashPrompt()) },
            {
              label: `Refresh (${formatShortcut(SHORTCUTS.refresh, isMac(platform))})`,
              separator: true,
              onSelect: refresh,
            },
          ]);
        }}
      >
        <Ellipsis size={15} />
      </button>
    </div>
  );
}

export function WorkspaceHeader() {
  const tree = useApp(activeWorktree);
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const changed = useApp((s) => new Set(s.files.map((f) => f.path)).size);
  const platform = useApp((s) => s.platform);
  const mac = isMac(platform);
  return (
    <header className="workspace-header">
      <div className="header-title">
        <span className="truncate header-name" title={tree?.path}>
          {tree?.name}
        </span>
        <span className="header-branch">
          <GitBranch size={12} />
          <span className="truncate">{tree?.branch ?? "Detached HEAD"}</span>
          <Tracking />
        </span>
      </div>
      <Segmented
        label="View"
        value={mode}
        onChange={setMode}
        options={[
          {
            value: "history",
            label: "History",
            title: `History (${formatShortcut(SHORTCUTS.history, mac)})`,
          },
          {
            value: "changes",
            title: `Changes (${formatShortcut(SHORTCUTS.changes, mac)})`,
            label: (
              <>
                Changes
                {changed ? (
                  <span className="count-pill accent">{changed}</span>
                ) : null}
              </>
            ),
          },
        ]}
      />
      <RemoteButtons />
    </header>
  );
}
