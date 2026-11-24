import type { Ref } from "react";
import type { ChunkChoice, Segment } from "../../bridge";
import {
  markerLabel,
  previewLines,
  stripEol,
  type ConflictChunk,
} from "../../lib/conflict";

const CONTEXT = 3;

/** Unchanged lines between conflicts, folded to a few lines of context. */
export function TextRun({
  lines,
  first,
  last,
}: {
  lines: string[];
  first: boolean;
  last: boolean;
}) {
  const shown = lines.map(stripEol);
  const head = first ? [] : shown.slice(0, CONTEXT);
  const tail = last ? [] : shown.slice(-CONTEXT);
  const folded = shown.length > head.length + tail.length;
  const visible = folded ? null : shown;
  return (
    <div className="text-run mono">
      {visible ? (
        visible.map((line, i) => (
          <div key={i} className="code-line">
            {line || " "}
          </div>
        ))
      ) : (
        <>
          {head.map((line, i) => (
            <div key={`h${i}`} className="code-line">
              {line || " "}
            </div>
          ))}
          <div className="fold">
            {shown.length - head.length - tail.length} unchanged lines
          </div>
          {tail.map((line, i) => (
            <div key={`t${i}`} className="code-line">
              {line || " "}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Side({
  title,
  tone,
  lines,
}: {
  title: string;
  tone: "ours" | "theirs" | "base";
  lines: string[];
}) {
  return (
    <div className={`chunk-side ${tone}`}>
      <div className="chunk-side-title truncate" title={title}>
        {title}
      </div>
      <div className="chunk-lines mono">
        {lines.length === 0 ? (
          <div className="code-line faint">(no lines)</div>
        ) : null}
        {lines.map((line, i) => (
          <div key={i} className="code-line">
            {stripEol(line) || " "}
          </div>
        ))}
      </div>
    </div>
  );
}

interface CardProps {
  ref: Ref<HTMLDivElement>;
  chunk: ConflictChunk;
  index: number;
  total: number;
  active: boolean;
  choice: ChunkChoice | null;
  names: { ours: string; theirs: string };
  onChoose: (choice: ChunkChoice) => void;
  onFocus: () => void;
}

export function ChunkCard({
  ref,
  chunk,
  index,
  total,
  active,
  choice,
  names,
  onChoose,
  onFocus,
}: CardProps) {
  const ours = markerLabel(chunk.oursLabel, names.ours);
  const theirs = markerLabel(chunk.theirsLabel, names.theirs);
  const options: { value: ChunkChoice; label: string }[] = [
    { value: "ours", label: `Accept ${ours}` },
    { value: "theirs", label: `Accept ${theirs}` },
    { value: "oursThenTheirs", label: `Both, ${names.ours} first` },
    { value: "theirsThenOurs", label: `Both, ${names.theirs} first` },
  ];
  const result = previewLines([chunk], [choice]);
  return (
    <div
      ref={ref}
      className={`chunk-card${active ? " active" : ""}${choice ? " chosen" : ""}`}
      onClick={onFocus}
      data-testid="chunk-card"
    >
      <div className="chunk-head">
        <span className="chunk-title">
          Conflict {index + 1} of {total}
        </span>
        <div
          className="chunk-choices"
          role="group"
          aria-label={`Resolve conflict ${index + 1}`}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={choice === option.value}
              className={`choice ${option.value}`}
              title={
                option.value === "oursThenTheirs"
                  ? `${ours} first, then ${theirs}`
                  : option.value === "theirsThenOurs"
                    ? `${theirs} first, then ${ours}`
                    : undefined
              }
              onClick={(event) => {
                event.stopPropagation();
                onChoose(option.value);
              }}
            >
              <span className="truncate">{option.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={`chunk-sides${chunk.base ? " three" : ""}`}>
        <Side title={ours} tone="ours" lines={chunk.ours} />
        {chunk.base ? (
          <Side
            title={`Base${chunk.baseLabel ? ` · ${chunk.baseLabel}` : ""}`}
            tone="base"
            lines={chunk.base}
          />
        ) : null}
        <Side title={theirs} tone="theirs" lines={chunk.theirs} />
      </div>
      <div className="chunk-result">
        <span className="chunk-result-label">Result</span>
        {choice === null ? (
          <span className="faint">
            Choose a side above. The file on disk is unchanged until you save.
          </span>
        ) : (
          <div className="chunk-lines mono">
            {result.map((line, i) => (
              <div key={i} className={`code-line from-${line.origin}`}>
                {line.text || " "}
              </div>
            ))}
            {result.length === 0 ? (
              <div className="code-line faint">(empty)</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** The whole file as it will be saved. */
export function ResultPreview({
  segments,
  choices,
}: {
  segments: Segment[];
  choices: (ChunkChoice | null)[];
}) {
  const lines = previewLines(segments, choices);
  return (
    <div className="result-preview mono" data-testid="result-preview">
      {lines.map((line, i) =>
        line.origin === "pending" ? (
          <div key={i} className="code-line pending">
            Conflict {(line.chunk ?? 0) + 1} has no choice yet
          </div>
        ) : (
          <div key={i} className={`code-line from-${line.origin}`}>
            <span className="line-number">{i + 1}</span>
            {line.text || " "}
          </div>
        ),
      )}
    </div>
  );
}
