/** Path helpers that accept both `/` and `\` separators. */

const SEPARATOR = /[\\/]/;

export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(SEPARATOR);
  return parts.at(-1) || trimmed || path;
}

/** Folder part of a repository-relative path, or "" at the top level. */
export function folderOf(path: string): string {
  if (path.endsWith("/")) return "";
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** File name of a repository-relative path; nested repositories keep their trailing slash. */
export function fileName(path: string): string {
  if (path.endsWith("/")) return path;
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

/** Default folder name for a new worktree: `<project>-<branch>`, with `/` turned into `-`. */
export function suggestWorktreeName(
  projectPath: string,
  branch: string,
): string {
  return `${baseName(projectPath)}-${branch.replace(/[\\/]/g, "-")}`;
}
