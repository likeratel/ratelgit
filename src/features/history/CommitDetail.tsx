import { GitCommitHorizontal } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import type { ChangedFile, CommitInfo } from "../../bridge";
import {
  formatDateTime,
  plural,
  shortHash,
  splitMessage,
} from "../../lib/format";
import { useApp } from "../../state/context";
import { EmptyState } from "../../ui/EmptyState";
import { Splitter } from "../../ui/Splitter";
import { DiffView } from "../diff/DiffView";
import { FileLabel } from "../files/FileRow";

function Summary({ info }: { info: CommitInfo }) {
  const selectCommit = useApp((s) => s.selectCommit);
  const { subject, body } = splitMessage(info.detail.message);
  const { detail } = info;
  return (
    <div className="commit-summary">
      <h2 className="selectable commit-subject">{subject}</h2>
      {body ? <p className="selectable commit-body">{body}</p> : null}
      <dl className="commit-meta">
        <dt>Author</dt>
        <dd
          className="selectable truncate"
          title={`${detail.author} <${detail.email}>`}
        >
          {detail.author} <span className="faint">&lt;{detail.email}&gt;</span>
        </dd>
        <dt>Date</dt>
        <dd className="selectable">{formatDateTime(detail.date)}</dd>
        <dt>Commit</dt>
        <dd className="selectable mono truncate commit-hash">{detail.hash}</dd>
        <dt>{detail.parents.length === 1 ? "Parent" : "Parents"}</dt>
        <dd className="parents">
          {detail.parents.length === 0 ? (
            <span className="faint">None</span>
          ) : null}
          {detail.parents.map((parent) => (
            <button
              key={parent}
              type="button"
              className="link mono"
              title={`Show parent ${parent}`}
              onClick={() => void selectCommit(parent)}
            >
              {shortHash(parent)}
            </button>
          ))}
        </dd>
      </dl>
    </div>
  );
}

function FileList({ files }: { files: ChangedFile[] }) {
  const current = useApp((s) => s.historyFile?.file ?? null);
  const selectFile = useApp((s) => s.selectFile);
  const list = useRef<HTMLDivElement>(null);
  const index = files.findIndex((f) => f.path === current?.path);
  const onKey = (event: KeyboardEvent) => {
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const next = files[index + step];
    if (!step || !next) return;
    event.preventDefault();
    void selectFile(next);
  };
  return (
    <div className="commit-files">
      <div className="list-heading">{plural(files.length, "changed file")}</div>
      <div
        className="file-scroll"
        ref={list}
        tabIndex={0}
        onKeyDown={onKey}
        role="listbox"
        aria-label="Changed files"
      >
        {files.length === 0 ? (
          <p className="sidebar-note">This commit changes no files.</p>
        ) : null}
        {files.map((file) => (
          <div
            key={file.path}
            role="option"
            aria-selected={file.path === current?.path}
            className={`file-row${file.path === current?.path ? " selected" : ""}`}
            onClick={() => void selectFile(file)}
          >
            <FileLabel file={file} />
          </div>
        ))}
      </div>
    </div>
  );
}

const INFO_WIDTH = { min: 260, max: 520 };

/** The selected commit: message, metadata and files on the left, the file's diff on the right. */
export function CommitDetail() {
  const commit = useApp((s) => s.commit);
  const view = useApp((s) => s.historyFile);
  const infoWidth = useRef(340);
  const panel = useRef<HTMLDivElement>(null);
  if (!commit) {
    return (
      <div className="commit-detail empty-detail" data-testid="commit-detail">
        <EmptyState
          icon={<GitCommitHorizontal size={20} />}
          title="Select a commit"
        >
          Choose a commit above to read its message, changed files and diff.
        </EmptyState>
      </div>
    );
  }
  return (
    <div
      className="commit-detail"
      ref={panel}
      data-testid="commit-detail"
      style={{
        gridTemplateColumns: `${infoWidth.current}px 1px minmax(0, 1fr)`,
      }}
    >
      <div className="commit-info">
        {commit.info ? (
          <>
            <Summary info={commit.info} />
            <FileList files={commit.info.files} />
          </>
        ) : (
          <div className="empty">
            <span className="spinner" />
          </div>
        )}
      </div>
      <Splitter
        orientation="vertical"
        label="Resize commit details"
        onDrag={(x) => {
          infoWidth.current = Math.min(
            INFO_WIDTH.max,
            Math.max(INFO_WIDTH.min, x),
          );
          if (panel.current)
            panel.current.style.gridTemplateColumns = `${infoWidth.current}px 1px minmax(0, 1fr)`;
        }}
      />
      <DiffView
        view={view}
        editable={false}
        emptyHint="Choose a file of this commit to see its diff."
      />
    </div>
  );
}
