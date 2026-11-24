import { CircleCheck } from "lucide-react";
import { SPLIT_RANGE } from "../../bridge";
import { useApp } from "../../state/context";
import { EmptyState } from "../../ui/EmptyState";
import { Splitter } from "../../ui/Splitter";
import { ConflictView } from "../conflicts/ConflictView";
import { DiffView } from "../diff/DiffView";
import { CommitBox } from "./CommitBox";
import { FileList } from "./FileList";

const clamp = (value: number) =>
  Math.min(SPLIT_RANGE.max, Math.max(SPLIT_RANGE.min, value));

export function ChangesPane() {
  const files = useApp((s) => s.files);
  const loading = useApp((s) => s.loading);
  const view = useApp((s) => s.changesFile);
  const split = useApp((s) => s.ui.changesSplit);
  const updateUi = useApp((s) => s.updateUi);
  const conflicted = view?.file.status === "U";
  return (
    <div
      className="changes-pane"
      style={{
        gridTemplateColumns: `minmax(300px, ${split}fr) 1px minmax(380px, ${1 - split}fr)`,
      }}
    >
      <div className="changes-left">
        <div className="pane-header">
          <span className="pane-title">Working Changes</span>
          {files.length ? (
            <span className="faint small-text hint">
              Space stages or unstages
            </span>
          ) : null}
        </div>
        {files.length === 0 ? (
          <EmptyState
            icon={<CircleCheck size={20} />}
            title={loading ? "Reading changes…" : "Working tree clean"}
            testId="changes-empty"
          >
            {loading ? "" : "Nothing to stage or commit in this worktree."}
          </EmptyState>
        ) : (
          <FileList />
        )}
        <CommitBox />
      </div>
      <Splitter
        orientation="vertical"
        label="Resize changes and diff"
        onDrag={(x, width) =>
          updateUi({ changesSplit: Number(clamp(x / width).toFixed(3)) })
        }
      />
      {conflicted && view ? (
        <ConflictView view={view} />
      ) : (
        <DiffView
          view={view}
          editable
          emptyHint={
            files.length
              ? "Choose a file to see its changes."
              : "There are no changes to show."
          }
        />
      )}
    </div>
  );
}
