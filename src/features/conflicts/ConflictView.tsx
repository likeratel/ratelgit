import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileWarning,
} from "lucide-react";
import { useRef, useState } from "react";
import type { ChangedFile, ChunkChoice, OperationState } from "../../bridge";
import {
  conflictChunks,
  describeConflict,
  nextUnresolved,
  quickResolutions,
  sideNames,
  unresolvedCount,
  type QuickResolution,
} from "../../lib/conflict";
import { fileName } from "../../lib/paths";
import { useApp } from "../../state/context";
import { deleteConflictedConfirmation } from "../../state/dialogs";
import type { FileView } from "../../state/types";
import { EmptyState } from "../../ui/EmptyState";
import { Segmented } from "../../ui/Segmented";
import { ChunkCard, ResultPreview, TextRun } from "./ChunkCard";

function QuickActions({
  file,
  operation,
}: {
  file: ChangedFile;
  operation: OperationState | null;
}) {
  const execute = useApp((s) => s.execute);
  const confirm = useApp((s) => s.confirm);
  const openFile = useApp((s) => s.openFile);
  const busy = useApp((s) => s.loading || s.mutation !== null);
  const names = sideNames(operation);
  const labels: Record<QuickResolution, string> = {
    useOurs: `Use ${names.ours}`,
    useTheirs: `Use ${names.theirs}`,
    keep: "Keep File",
    delete: "Delete File…",
  };
  const run = (resolution: QuickResolution) => {
    if (resolution === "delete")
      return confirm(deleteConflictedConfirmation(file));
    if (resolution === "keep")
      return void execute({ type: "keepFile", file }, "Keep File");
    const side = resolution === "useOurs" ? "ours" : "theirs";
    void execute({ type: "resolveSide", file, side }, labels[resolution]);
  };
  return (
    <div className="conflict-quick">
      {quickResolutions(file.conflict).map((resolution) => (
        <button
          key={resolution}
          type="button"
          className={`button small${resolution === "delete" ? " danger" : ""}`}
          disabled={busy}
          title={
            resolution === "useOurs" || resolution === "useTheirs"
              ? "Take the whole file from this side and stage it"
              : undefined
          }
          onClick={() => run(resolution)}
        >
          <span className="truncate">{labels[resolution]}</span>
        </button>
      ))}
      <button
        type="button"
        className="button small"
        disabled={busy}
        title="Stage the file as it is on disk"
        onClick={() =>
          void execute(
            { type: "markResolved", file, force: false },
            "Mark Resolved",
          )
        }
      >
        Mark Resolved
      </button>
      <button
        type="button"
        className="button small ghost"
        title="Open in the default app"
        onClick={() => void openFile(file.path)}
      >
        <ExternalLink size={13} /> Open
      </button>
    </div>
  );
}

function ChunkNavigator({
  choices,
  active,
  go,
}: {
  choices: (ChunkChoice | null)[];
  active: number;
  go: (index: number) => void;
}) {
  const left = unresolvedCount(choices);
  const step = (direction: 1 | -1) => {
    const next = nextUnresolved(choices, active, direction);
    go(next ?? (active + direction + choices.length) % choices.length);
  };
  return (
    <div className="chunk-nav">
      <span
        className={left ? "warn-text" : "ok-text"}
        data-testid="unresolved-count"
      >
        {left
          ? `${left} of ${choices.length} conflicts to choose`
          : `All ${choices.length} conflicts chosen`}
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label="Previous conflict"
        title="Previous conflict"
        onClick={() => step(-1)}
      >
        <ChevronUp size={15} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Next conflict"
        title="Next conflict"
        onClick={() => step(1)}
      >
        <ChevronDown size={15} />
      </button>
    </div>
  );
}

/** Conflicted file: whole-file actions, and per-chunk choices when the markers parse cleanly. */
export function ConflictView({ view }: { view: FileView }) {
  const operation = useApp((s) => s.operation);
  const execute = useApp((s) => s.execute);
  const chooseChunk = useApp((s) => s.chooseChunk);
  const reloadConflict = useApp((s) => s.reloadConflict);
  const busy = useApp((s) => s.loading || s.mutation !== null);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<"chunks" | "result">("chunks");
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const document = view.conflict;
  const names = sideNames(operation);

  const go = (index: number) => {
    setActive(index);
    setMode("chunks");
    requestAnimationFrame(() =>
      cards.current[index]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      }),
    );
  };

  const header = (
    <header className="diff-header conflict-header">
      <div className="diff-file">
        <FileWarning size={15} className="conflict-icon" />
        <span className="truncate diff-file-name" title={view.file.path}>
          {fileName(view.file.path)}
        </span>
        <span className="truncate muted small-text">
          {describeConflict(view.file.conflict, operation)}
        </span>
      </div>
      <QuickActions file={view.file} operation={operation} />
    </header>
  );

  if (!document) {
    return (
      <div className="diff-view">
        {header}
        {view.unavailable ? (
          <EmptyState
            icon={<FileWarning size={20} />}
            title="The file could not be read"
          >
            {view.unavailable}
          </EmptyState>
        ) : (
          <div className="empty">
            <span className="spinner" />
          </div>
        )}
      </div>
    );
  }

  if (document.state !== "ready") {
    const manual =
      document.state === "malformed"
        ? "Resolve this file by hand in an editor, then mark it resolved."
        : "Choose a whole-file action above.";
    return (
      <div className="diff-view" data-testid="conflict-view">
        {header}
        <EmptyState
          icon={<FileWarning size={20} />}
          title={
            document.state === "malformed"
              ? "Needs manual resolution"
              : (document.reason ?? "Resolve as a whole file")
          }
        >
          {document.state === "malformed"
            ? `${document.reason ?? ""} ${manual}`
            : manual}
        </EmptyState>
      </div>
    );
  }

  const chunks = conflictChunks(document.segments);
  const done = unresolvedCount(view.choices) === 0;
  let chunkIndex = -1;
  return (
    <div className="diff-view conflict-view" data-testid="conflict-view">
      {header}
      <div className="conflict-toolbar">
        <ChunkNavigator choices={view.choices} active={active} go={go} />
        <Segmented
          small
          label="Conflict view"
          value={mode}
          onChange={setMode}
          options={[
            { value: "chunks", label: "Choose" },
            { value: "result", label: "Result preview" },
          ]}
        />
        <button
          type="button"
          className="button small ghost"
          onClick={reloadConflict}
          title="Read the file from disk again"
        >
          Reload
        </button>
        <button
          type="button"
          className="button small primary"
          disabled={!done || busy}
          title={
            done
              ? "Write the result to the file and stage it"
              : "Choose a side for every conflict first"
          }
          data-testid="save-resolution"
          onClick={() =>
            void execute(
              {
                type: "saveResolution",
                file: view.file,
                fingerprint: document.fingerprint ?? "",
                choices: view.choices.filter(
                  (c): c is ChunkChoice => c !== null,
                ),
              },
              "Save Resolution",
            )
          }
        >
          Save and Mark Resolved
        </button>
      </div>
      <div className="conflict-scroll">
        {mode === "result" ? (
          <ResultPreview segments={document.segments} choices={view.choices} />
        ) : (
          document.segments.map((segment, index) => {
            if (segment.type === "text")
              return (
                <TextRun
                  key={index}
                  lines={segment.lines}
                  first={index === 0}
                  last={index === document.segments.length - 1}
                />
              );
            chunkIndex += 1;
            const at = chunkIndex;
            return (
              <ChunkCard
                key={index}
                ref={(node) => {
                  cards.current[at] = node;
                }}
                chunk={segment}
                index={at}
                total={chunks.length}
                active={at === active}
                choice={view.choices[at] ?? null}
                names={names}
                onFocus={() => setActive(at)}
                onChoose={(choice) => {
                  chooseChunk(at, choice);
                  const next = nextUnresolved(
                    view.choices.map((c, i) => (i === at ? choice : c)),
                    at,
                    1,
                  );
                  if (next !== null && next !== at) go(next);
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
