import { CircleMinus, CirclePlus, Trash2, Undo2 } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import type { ChangedFile } from "../../bridge";
import { describeConflict } from "../../lib/conflict";
import { useApp } from "../../state/context";
import { discardConfirmation } from "../../state/dialogs";
import { sameFile } from "../../state/helpers";
import { FileLabel } from "../files/FileRow";
import { groupFiles } from "./groups";

function RowActions({ file }: { file: ChangedFile }) {
  const execute = useApp((s) => s.execute);
  const confirm = useApp((s) => s.confirm);
  const busy = useApp((s) => s.loading || s.mutation !== null);
  if (file.status === "U") return null;
  const staged = file.kind === "staged";
  return (
    <span className="row-actions">
      {!staged ? (
        <button
          type="button"
          className="icon-button hover-only"
          disabled={busy}
          title={
            file.kind === "untracked"
              ? "Delete untracked file…"
              : "Discard changes…"
          }
          aria-label={
            file.kind === "untracked"
              ? "Delete untracked file"
              : "Discard changes"
          }
          onClick={(event) => {
            event.stopPropagation();
            confirm(discardConfirmation(file));
          }}
        >
          {file.kind === "untracked" ? (
            <Trash2 size={14} />
          ) : (
            <Undo2 size={14} />
          )}
        </button>
      ) : null}
      <button
        type="button"
        className={`icon-button stage-button${staged ? "" : " add"}`}
        disabled={busy}
        title={staged ? "Unstage file" : "Stage file"}
        aria-label={staged ? "Unstage file" : "Stage file"}
        onClick={(event) => {
          event.stopPropagation();
          void execute(
            { type: staged ? "unstage" : "stage", file },
            staged ? "Unstage" : "Stage",
          );
        }}
      >
        {staged ? <CircleMinus size={15} /> : <CirclePlus size={15} />}
      </button>
    </span>
  );
}

export function FileList() {
  const files = useApp((s) => s.files);
  const operation = useApp((s) => s.operation);
  const current = useApp((s) => s.changesFile?.file ?? null);
  const selectFile = useApp((s) => s.selectFile);
  const execute = useApp((s) => s.execute);
  const groups = groupFiles(files);
  const ordered = groups.flatMap((g) => g.files);
  const list = useRef<HTMLDivElement>(null);

  const onKey = (event: KeyboardEvent) => {
    const index = current ? ordered.findIndex((f) => sameFile(f, current)) : -1;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const next = ordered[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) void selectFile(next);
      event.preventDefault();
    }
    if (event.code === "Space" && current && current.status !== "U") {
      event.preventDefault();
      const staged = current.kind === "staged";
      void execute(
        { type: staged ? "unstage" : "stage", file: current },
        staged ? "Unstage" : "Stage",
      );
    }
  };

  return (
    <div
      className="change-list"
      ref={list}
      tabIndex={0}
      onKeyDown={onKey}
      role="listbox"
      aria-label="Changed files"
      data-testid="change-list"
    >
      {groups.map((group) => (
        <div
          key={group.key}
          className={`change-group ${group.key}`}
          role="group"
          aria-label={group.title}
        >
          <div className="list-heading">
            {group.title}{" "}
            <span className="faint tabular">{group.files.length}</span>
          </div>
          {group.files.map((file) => {
            const selected = current !== null && sameFile(file, current);
            return (
              <div
                key={`${file.kind}:${file.path}`}
                role="option"
                aria-selected={selected}
                className={`file-row change-row${selected ? " selected" : ""}`}
                data-testid="change-row"
                onClick={() => void selectFile(file)}
              >
                <span className="change-text">
                  <FileLabel file={file} />
                  {file.status === "U" ? (
                    <span className="conflict-kind">
                      {describeConflict(file.conflict, operation)}
                    </span>
                  ) : null}
                </span>
                <RowActions file={file} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
