import { FolderGit2, FolderOpen } from "lucide-react";
import { useEffect, type CSSProperties } from "react";
import { SIDEBAR_WIDTH } from "./bridge";
import { ChangesPane } from "./features/changes/ChangesPane";
import { Dialogs } from "./features/dialogs/Dialogs";
import { HistoryPane } from "./features/history/HistoryPane";
import { Sidebar } from "./features/sidebar/Sidebar";
import { QuickSwitcher } from "./features/switcher/QuickSwitcher";
import { OperationBanner } from "./features/workspace/OperationBanner";
import { ErrorBar, NoticeBar, StatusBar } from "./features/workspace/StatusBar";
import { WorkspaceHeader } from "./features/workspace/WorkspaceHeader";
import { formatShortcut, isMac, SHORTCUTS } from "./lib/shortcuts";
import { useFocusRefresh } from "./shell/useFocusRefresh";
import { useShortcuts } from "./shell/useShortcuts";
import { useApp, useAppStore } from "./state/context";
import { EmptyState } from "./ui/EmptyState";
import { Splitter } from "./ui/Splitter";

function NoWorktree() {
  const hasProjects = useApp((s) => s.projects.length > 0);
  const ready = useApp((s) => s.ready);
  const addProject = useApp((s) => s.addProject);
  const platform = useApp((s) => s.platform);
  const mac = isMac(platform);
  if (!ready) return <div className="empty" />;
  return hasProjects ? (
    <EmptyState icon={<FolderOpen size={20} />} title="Select a worktree">
      {`Choose a worktree in the sidebar, or press ${formatShortcut(SHORTCUTS.quickOpen, mac)} to jump to one.`}
    </EmptyState>
  ) : (
    <EmptyState
      icon={<FolderGit2 size={20} />}
      title="Open a Git repository"
      actions={
        <button
          type="button"
          className="button primary"
          onClick={() => void addProject()}
        >
          Add Repository…{" "}
          <kbd>{formatShortcut(SHORTCUTS.openRepository, mac)}</kbd>
        </button>
      }
    >
      Add repositories to the sidebar, then move between their worktrees to read
      history, changes and diffs.
    </EmptyState>
  );
}

function Workspace() {
  const mode = useApp((s) => s.mode);
  const busy = useApp((s) => s.mutation !== null);
  return (
    <>
      <WorkspaceHeader />
      <OperationBanner />
      <div className="workspace-body" aria-busy={busy}>
        {mode === "history" ? <HistoryPane /> : <ChangesPane />}
      </div>
    </>
  );
}

export function App() {
  const store = useAppStore();
  const active = useApp((s) => s.activePath !== null);
  const sidebarWidth = useApp((s) => s.ui.sidebarWidth);
  const updateUi = useApp((s) => s.updateUi);
  useShortcuts();
  useFocusRefresh();
  useEffect(() => {
    void store.getState().init();
  }, [store]);
  useEffect(() => {
    const block = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("input, textarea, .selectable"))
        event.preventDefault();
    };
    window.addEventListener("contextmenu", block);
    return () => window.removeEventListener("contextmenu", block);
  }, []);
  return (
    <div
      className="app"
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <div className="app-body">
        <Sidebar />
        <Splitter
          orientation="vertical"
          label="Resize sidebar"
          onDrag={(x) =>
            updateUi({
              sidebarWidth: Math.round(
                Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, x)),
              ),
            })
          }
        />
        <main className="workspace">
          {active ? <Workspace /> : <NoWorktree />}
        </main>
      </div>
      <NoticeBar />
      <ErrorBar />
      <StatusBar />
      <QuickSwitcher />
      <Dialogs />
    </div>
  );
}
