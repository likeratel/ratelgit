import { FileSearch } from "lucide-react";
import { useMemo, useState } from "react";
import type { ChangedFile } from "../../bridge";
import { fileName } from "../../lib/paths";
import { changedLinesIn, hunkAt, parsePatch } from "../../lib/patch";
import { buildDocument } from "../../lib/patchDocument";
import { useApp } from "../../state/context";
import {
  discardConfirmation,
  discardLinesConfirmation,
} from "../../state/dialogs";
import type { FileView } from "../../state/types";
import { EmptyState } from "../../ui/EmptyState";
import { Segmented } from "../../ui/Segmented";
import { DiffBody, type LineStaging } from "./DiffBody";
import {
  OPERATION_LABELS,
  stagingOperations,
  type LineOperation,
} from "./staging";

function FileActions({ file }: { file: ChangedFile }) {
  const execute = useApp((s) => s.execute);
  const confirm = useApp((s) => s.confirm);
  const busy = useApp((s) => s.loading || s.mutation !== null);
  if (file.kind === "committed") return null;
  if (file.kind === "staged") {
    return (
      <button
        type="button"
        className="button small"
        disabled={busy}
        onClick={() => void execute({ type: "unstage", file }, "Unstage")}
      >
        Unstage File
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        className="button small"
        disabled={busy}
        onClick={() => void execute({ type: "stage", file }, "Stage")}
      >
        Stage File
      </button>
      <button
        type="button"
        className="button small danger"
        disabled={busy}
        onClick={() => confirm(discardConfirmation(file))}
      >
        {file.kind === "untracked" ? "Delete…" : "Discard…"}
      </button>
    </>
  );
}

function DiffOptions() {
  const ui = useApp((s) => s.ui);
  const updateUi = useApp((s) => s.updateUi);
  return (
    <div className="diff-options">
      <label
        className="checkbox"
        title="Hide whitespace-only changes. Hunk and line staging is off while this is on."
      >
        <input
          type="checkbox"
          checked={ui.ignoreWhitespace}
          onChange={(event) =>
            updateUi({ ignoreWhitespace: event.target.checked })
          }
        />
        Ignore whitespace
      </label>
      <Segmented
        small
        label="Diff layout"
        value={ui.diffLayout}
        onChange={(diffLayout) => updateUi({ diffLayout })}
        options={[
          { value: "unified", label: "Unified" },
          { value: "split", label: "Split" },
        ]}
      />
    </div>
  );
}

interface Props {
  view: FileView | null;
  editable: boolean;
  emptyHint: string;
}

/** Diff of the selected file with layout and whitespace options; in Changes also hunk and line staging. */
export function DiffView({ view, editable, emptyHint }: Props) {
  const ui = useApp((s) => s.ui);
  const execute = useApp((s) => s.execute);
  const confirm = useApp((s) => s.confirm);
  const text = view?.diff?.text ?? "";
  const document = useMemo(() => buildDocument(text), [text]);
  const [selection, setSelection] = useState<{
    text: string;
    lines: ReadonlySet<number>;
  }>({ text: "", lines: new Set() });
  const selected =
    selection.text === text ? selection.lines : new Set<number>();
  const file = view?.file ?? null;
  const operations = editable
    ? stagingOperations(file, view?.diff ?? null, ui.ignoreWhitespace)
    : [];

  const run = (operation: LineOperation, lines: number[], hunk: boolean) => {
    if (!file) return;
    if (operation === "discard")
      confirm(discardLinesConfirmation(file, text, lines, hunk));
    else
      void execute(
        { type: "applyLines", file, source: text, lines, operation },
        OPERATION_LABELS[operation],
      );
    setSelection({ text: "", lines: new Set() });
  };

  const staging: LineStaging | undefined = operations.length
    ? {
        operations,
        selected,
        toggle: (index) => {
          const next = new Set(selected);
          if (next.has(index)) next.delete(index);
          else next.add(index);
          setSelection({ text, lines: next });
        },
        hunk: (operation, header) => {
          const patch = parsePatch(text);
          const hunk = hunkAt(patch, header);
          if (hunk) run(operation, changedLinesIn(patch, hunk), true);
        },
      }
    : undefined;

  if (!view) {
    return (
      <div className="diff-view">
        <EmptyState icon={<FileSearch size={20} />} title="No file selected">
          {emptyHint}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="diff-view" data-testid="diff-view">
      <header className="diff-header">
        <div className="diff-file">
          <span className="truncate diff-file-name" title={view.file.path}>
            {fileName(view.file.path)}
          </span>
          <span className="truncate faint diff-file-path selectable">
            {view.file.path}
          </span>
        </div>
        <div className="diff-header-actions">
          {editable ? <FileActions file={view.file} /> : null}
          <DiffOptions />
        </div>
      </header>
      {selected.size > 0 && staging ? (
        <div className="selection-bar">
          <span className="muted">
            {selected.size === 1
              ? "1 line selected"
              : `${selected.size} lines selected`}
          </span>
          <span className="selection-actions">
            {operations.map((operation) => (
              <button
                key={operation}
                type="button"
                className={`button small${operation === "discard" ? " danger" : " primary"}`}
                onClick={() => run(operation, [...selected], false)}
              >
                {OPERATION_LABELS[operation]} Lines
                {operation === "discard" ? "…" : ""}
              </button>
            ))}
            <button
              type="button"
              className="button small ghost"
              onClick={() => setSelection({ text: "", lines: new Set() })}
            >
              Clear
            </button>
          </span>
        </div>
      ) : null}
      {view.diff?.lossy || view.diff?.truncated ? (
        <div className="diff-notice">
          {view.diff.truncated
            ? "The diff is too large and was cut. "
            : "The file is not UTF-8 text; some characters are replaced. "}
          {editable ? "Stage or discard the whole file instead of hunks." : ""}
        </div>
      ) : null}
      {view.unavailable && !view.diff ? (
        <EmptyState
          icon={<FileSearch size={20} />}
          title="Diff not available"
          testId="diff-unavailable"
        >
          {view.unavailable}
        </EmptyState>
      ) : view.loading && !view.diff ? (
        <div className="empty">
          <span className="spinner" />
        </div>
      ) : document.display.length === 0 ? (
        <EmptyState icon={<FileSearch size={20} />} title="No text changes">
          {editable && ui.ignoreWhitespace
            ? "Only whitespace changed."
            : "The change has no text diff to show."}
        </EmptyState>
      ) : (
        <DiffBody
          document={document}
          split={ui.diffLayout === "split"}
          staging={staging}
        />
      )}
    </div>
  );
}
