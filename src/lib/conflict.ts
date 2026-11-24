/** View logic for conflicted files: labels, per-chunk choices and the result preview. */

import type {
  ChunkChoice,
  ConflictKind,
  OperationState,
  Segment,
} from "../bridge/types";

export type ConflictChunk = Extract<Segment, { type: "conflict" }>;
export type Choices = readonly (ChunkChoice | null)[];

export function conflictChunks(segments: readonly Segment[]): ConflictChunk[] {
  return segments.filter((s): s is ConflictChunk => s.type === "conflict");
}

export function stripEol(line: string): string {
  return line.replace(/\r?\n$/, "");
}

export function emptyChoices(
  segments: readonly Segment[],
): (ChunkChoice | null)[] {
  return conflictChunks(segments).map(() => null);
}

export function choose(
  choices: Choices,
  chunk: number,
  choice: ChunkChoice,
): (ChunkChoice | null)[] {
  return choices.map((current, index) => (index === chunk ? choice : current));
}

export function unresolvedCount(choices: Choices): number {
  return choices.filter((choice) => choice === null).length;
}

/** Next chunk without a choice after `from` (or before it, going back), wrapping around. */
export function nextUnresolved(
  choices: Choices,
  from: number,
  step: 1 | -1,
): number | null {
  const count = choices.length;
  for (let offset = 1; offset <= count; offset += 1) {
    const index = (((from + step * offset) % count) + count) % count;
    if (choices[index] === null) return index;
  }
  return null;
}

export type PreviewOrigin = "text" | "ours" | "theirs" | "pending";

export interface PreviewLine {
  text: string;
  origin: PreviewOrigin;
  /** Conflict chunk the line came from, or null for unchanged text. */
  chunk: number | null;
}

function chosenLines(
  chunk: ConflictChunk,
  choice: ChunkChoice,
): [string[], PreviewOrigin][] {
  switch (choice) {
    case "ours":
      return [[chunk.ours, "ours"]];
    case "theirs":
      return [[chunk.theirs, "theirs"]];
    case "oursThenTheirs":
      return [
        [chunk.ours, "ours"],
        [chunk.theirs, "theirs"],
      ];
    case "theirsThenOurs":
      return [
        [chunk.theirs, "theirs"],
        [chunk.ours, "ours"],
      ];
  }
}

/** The file as it will be saved; chunks without a choice show as one pending line. */
export function previewLines(
  segments: readonly Segment[],
  choices: Choices,
): PreviewLine[] {
  let chunkIndex = -1;
  return segments.flatMap((segment): PreviewLine[] => {
    if (segment.type === "text") {
      return segment.lines.map((line) => ({
        text: stripEol(line),
        origin: "text",
        chunk: null,
      }));
    }
    chunkIndex += 1;
    const index = chunkIndex;
    const choice = choices[index] ?? null;
    if (choice === null) return [{ text: "", origin: "pending", chunk: index }];
    return chosenLines(segment, choice).flatMap(([lines, origin]) =>
      lines.map((line) => ({ text: stripEol(line), origin, chunk: index })),
    );
  });
}

/** Names for the two sides, preferring branch names over the words ours and theirs. */
export function sideNames(operation: OperationState | null): {
  ours: string;
  theirs: string;
} {
  return {
    ours: operation?.ours ?? "Current",
    theirs: operation?.theirs ?? "Incoming",
  };
}

/** Marker label with the branch it stands for, e.g. "HEAD · fix/login". */
export function markerLabel(label: string, name: string): string {
  const trimmed = label.trim();
  if (!trimmed) return name;
  return trimmed === "HEAD" && name !== trimmed ? `HEAD · ${name}` : trimmed;
}

export function describeConflict(
  kind: ConflictKind | null,
  operation: OperationState | null,
): string {
  const { ours, theirs } = sideNames(operation);
  switch (kind) {
    case "bothModified":
      return "Changed on both sides";
    case "bothAdded":
      return "Added on both sides";
    case "bothDeleted":
      return "Deleted on both sides";
    case "addedByUs":
      return `Added only in ${ours}`;
    case "addedByThem":
      return `Added only in ${theirs}`;
    case "deletedByUs":
      return `Deleted in ${ours}, changed in ${theirs}`;
    case "deletedByThem":
      return `Deleted in ${theirs}, changed in ${ours}`;
    default:
      return "Conflicted";
  }
}

export type QuickResolution = "useOurs" | "useTheirs" | "keep" | "delete";

/** Whole-file actions that make sense for a conflict kind. */
export function quickResolutions(kind: ConflictKind | null): QuickResolution[] {
  switch (kind) {
    case "deletedByUs":
    case "deletedByThem":
    case "addedByUs":
    case "addedByThem":
      return ["keep", "delete"];
    case "bothDeleted":
      return ["delete"];
    default:
      return ["useOurs", "useTheirs"];
  }
}

export function operationTitle(operation: OperationState): string {
  const { ours, theirs } = sideNames(operation);
  switch (operation.kind) {
    case "merge":
      return `Merging ${theirs} into ${ours}`;
    case "rebase": {
      const step =
        operation.step && operation.total
          ? ` (step ${operation.step} of ${operation.total})`
          : "";
      return `Rebasing ${operation.branch ?? "HEAD"} onto ${ours}${step}`;
    }
    case "cherryPick":
      return `Cherry-picking ${theirs} onto ${ours}`;
    case "revert":
      return `Reverting ${theirs} on ${ours}`;
  }
}

export const OPERATION_NAMES: Record<OperationState["kind"], string> = {
  merge: "Merge",
  rebase: "Rebase",
  cherryPick: "Cherry-pick",
  revert: "Revert",
};
