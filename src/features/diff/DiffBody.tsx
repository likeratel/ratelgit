import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import {
  emphasisPieces,
  splitRows,
  type PatchDocument,
  type PatchLine,
} from "../../lib/patchDocument";
import { OPERATION_LABELS, type LineOperation } from "./staging";

const LINE_HEIGHT = 20;
const HUNK_HEIGHT = 28;
/** Selector, gutters, sign and padding beside the text, in pixels. */
const UNIFIED_CHROME = 150;
const SPLIT_CHROME = 86;

export interface LineStaging {
  operations: LineOperation[];
  selected: ReadonlySet<number>;
  toggle: (index: number) => void;
  hunk: (operation: LineOperation, header: number) => void;
}

function Text({ line }: { line: PatchLine }) {
  return (
    <span className="diff-text">
      {emphasisPieces(line.text, line.emphasis).map((piece, i) =>
        piece.strong ? (
          <mark key={i} className="word">
            {piece.text}
          </mark>
        ) : (
          <span key={i}>{piece.text}</span>
        ),
      )}
    </span>
  );
}

function Selector({
  line,
  staging,
}: {
  line: PatchLine;
  staging?: LineStaging;
}) {
  if (!staging) return null;
  const change = line.kind === "added" || line.kind === "removed";
  if (!change) return <span className="diff-select" />;
  const on = staging.selected.has(line.index);
  return (
    <button
      type="button"
      className={`diff-select box${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={on ? "Deselect line" : "Select line"}
      title={on ? "Deselect line" : "Select line to stage, unstage or discard"}
      onClick={() => staging.toggle(line.index)}
    />
  );
}

function HunkHeader({
  line,
  staging,
}: {
  line: PatchLine;
  staging?: LineStaging;
}) {
  return (
    <div className={`diff-row hunk${line.isHunkHeader ? "" : " note"}`}>
      <span className="diff-hunk-text">{line.text}</span>
      {line.isHunkHeader && staging
        ? staging.operations.map((operation) => (
            <button
              key={operation}
              type="button"
              className={`button small hunk-button${operation === "discard" ? " danger" : ""}`}
              data-testid={`hunk-${operation}`}
              onClick={() => staging.hunk(operation, line.index)}
            >
              {OPERATION_LABELS[operation]} Hunk
              {operation === "discard" ? "…" : ""}
            </button>
          ))
        : null}
    </div>
  );
}

const SIGN: Record<PatchLine["kind"], string> = {
  added: "+",
  removed: "−",
  context: "",
  header: "",
};

function UnifiedRow({
  line,
  staging,
}: {
  line: PatchLine;
  staging?: LineStaging;
}) {
  if (line.kind === "header")
    return <HunkHeader line={line} staging={staging} />;
  const selected = staging?.selected.has(line.index) ? " selected" : "";
  return (
    <div className={`diff-row ${line.kind}${selected}`}>
      <Selector line={line} staging={staging} />
      <span className="diff-num">{line.old ?? ""}</span>
      <span className="diff-num">{line.new ?? ""}</span>
      <span className="diff-sign">{SIGN[line.kind]}</span>
      <Text line={line} />
    </div>
  );
}

function SplitCell({
  line,
  side,
  staging,
}: {
  line: PatchLine | null;
  side: "old" | "new";
  staging?: LineStaging;
}) {
  if (!line) return <div className="diff-cell empty-cell" />;
  const selected = staging?.selected.has(line.index) ? " selected" : "";
  return (
    <div className={`diff-cell ${line.kind}${selected}`}>
      <Selector line={line} staging={staging} />
      <span className="diff-num">{side === "old" ? line.old : line.new}</span>
      <Text line={line} />
    </div>
  );
}

interface Props {
  document: PatchDocument;
  split: boolean;
  staging?: LineStaging;
}

export function DiffBody({ document, split, staging }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const rows = split ? splitRows(document.display) : null;
  const count = rows ? rows.length : document.display.length;
  const headerAt = (index: number) => {
    const line = rows ? rows[index].left : document.display[index];
    return line?.kind === "header" && (!rows || rows[index].right === null);
  };
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => (headerAt(index) ? HUNK_HEIGHT : LINE_HEIGHT),
    overscan: 20,
  });
  const width = split
    ? `calc(${document.longest * 2}ch + ${SPLIT_CHROME * 2}px)`
    : `calc(${document.longest}ch + ${UNIFIED_CHROME}px)`;
  return (
    <div className="diff-scroll" ref={scroller} data-testid="diff-body">
      <div
        className={`diff-canvas mono${split ? " split" : ""}`}
        style={{ height: virtualizer.getTotalSize(), minWidth: width }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const style = {
            transform: `translateY(${item.start}px)`,
            height: item.size,
          };
          if (!rows) {
            const line = document.display[item.index];
            return (
              <div key={item.key} className="diff-slot" style={style}>
                <UnifiedRow line={line} staging={staging} />
              </div>
            );
          }
          const row = rows[item.index];
          return (
            <div key={item.key} className="diff-slot" style={style}>
              {headerAt(item.index) && row.left ? (
                <HunkHeader line={row.left} staging={staging} />
              ) : (
                <div className="diff-row split-row">
                  <SplitCell line={row.left} side="old" staging={staging} />
                  <SplitCell line={row.right} side="new" staging={staging} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
