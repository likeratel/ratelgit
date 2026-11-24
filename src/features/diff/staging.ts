import type { ChangedFile, FileDiff } from "../../bridge";
import { parsePatch } from "../../lib/patch";

export type LineOperation = "stage" | "unstage" | "discard";

/** Hunk and line actions offered for a working-tree diff. They apply a patch built from this
 * exact text, so they need a plain (not whitespace-ignoring), complete UTF-8 diff. */
export function stagingOperations(
  file: ChangedFile | null,
  diff: FileDiff | null,
  ignoreWhitespace: boolean,
): LineOperation[] {
  if (
    !file ||
    !diff ||
    ignoreWhitespace ||
    diff.lossy ||
    diff.truncated ||
    file.status === "U"
  )
    return [];
  if (parsePatch(diff.text).hunks.length === 0) return [];
  if (file.kind === "unstaged") return ["stage", "discard"];
  if (file.kind === "staged") return ["unstage"];
  return [];
}

export const OPERATION_LABELS: Record<LineOperation, string> = {
  stage: "Stage",
  unstage: "Unstage",
  discard: "Discard",
};
