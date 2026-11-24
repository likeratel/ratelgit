import { SPLIT_RANGE } from "../../bridge";
import { useApp } from "../../state/context";
import { Splitter } from "../../ui/Splitter";
import { CommitDetail } from "./CommitDetail";
import { CommitList } from "./CommitList";

const clamp = (value: number) =>
  Math.min(SPLIT_RANGE.max, Math.max(SPLIT_RANGE.min, value));

/** History: the commit graph on top, the selected commit's details below. */
export function HistoryPane() {
  const split = useApp((s) => s.ui.historySplit);
  const updateUi = useApp((s) => s.updateUi);
  return (
    <div
      className="history-pane"
      style={{
        gridTemplateRows: `minmax(150px, ${split}fr) 1px minmax(190px, ${1 - split}fr)`,
      }}
    >
      <CommitList />
      <Splitter
        orientation="horizontal"
        label="Resize history and commit details"
        onDrag={(y, height) =>
          updateUi({ historySplit: Number(clamp(y / height).toFixed(3)) })
        }
      />
      <CommitDetail />
    </div>
  );
}
