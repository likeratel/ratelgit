import type { ChangedFile } from "../../bridge";
import { fileName, folderOf } from "../../lib/paths";

const TONES: Record<string, string> = {
  A: "added",
  "?": "added",
  D: "removed",
  "!": "conflict",
};

export function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={`status-chip ${TONES[status] ?? "modified"}`}
      aria-label={`Status ${status}`}
    >
      {status}
    </span>
  );
}

/** Status letter, file name and its folder. */
export function FileLabel({ file }: { file: ChangedFile }) {
  const folder = folderOf(file.path);
  return (
    <span className="file-label" title={file.path}>
      <StatusChip status={file.status === "U" ? "!" : file.status} />
      <span className="truncate file-name">{fileName(file.path)}</span>
      {folder ? <span className="truncate file-folder">{folder}</span> : null}
    </span>
  );
}
