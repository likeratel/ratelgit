import type { ChangedFile } from "../../bridge";

export interface FileGroup {
  key: string;
  title: string;
  files: ChangedFile[];
}

const GROUPS: {
  key: string;
  title: string;
  include: (file: ChangedFile) => boolean;
}[] = [
  { key: "conflicts", title: "Conflicts", include: (f) => f.status === "U" },
  {
    key: "unstaged",
    title: "Unstaged",
    include: (f) => f.kind === "unstaged" && f.status !== "U",
  },
  {
    key: "untracked",
    title: "Untracked",
    include: (f) => f.kind === "untracked",
  },
  { key: "staged", title: "Staged", include: (f) => f.kind === "staged" },
];

/** Working files in display order: conflicts first, staged last. Empty groups are left out. */
export function groupFiles(files: readonly ChangedFile[]): FileGroup[] {
  return GROUPS.map((group) => ({
    key: group.key,
    title: group.title,
    files: files.filter(group.include),
  })).filter((group) => group.files.length > 0);
}
