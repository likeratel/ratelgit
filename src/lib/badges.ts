/** Ref names from `%D`, classified for the history row: HEAD branch, local, remote and tag. */

export type BadgeKind = "head" | "local" | "remote" | "tag";

export interface Badge {
  text: string;
  kind: BadgeKind;
  /** Remote branch at the same commit, folded into this local badge. */
  remote: string | null;
}

function classify(label: string, remotes: ReadonlySet<string>): Badge {
  if (label.startsWith("HEAD -> "))
    return { text: label.slice(8), kind: "head", remote: null };
  if (label.startsWith("tag: "))
    return { text: label.slice(5), kind: "tag", remote: null };
  if (label === "HEAD") return { text: "HEAD", kind: "head", remote: null };
  return {
    text: label,
    kind: remotes.has(label) ? "remote" : "local",
    remote: null,
  };
}

/** Classifies labels and folds `origin/x` into a local `x` badge when both point at this commit. */
export function badgesFor(
  labels: readonly string[],
  remotes: ReadonlySet<string>,
): Badge[] {
  const all = labels
    .filter((label) => !label.endsWith("/HEAD"))
    .map((l) => classify(l, remotes));
  const locals = new Set(
    all
      .filter((b) => b.kind === "local" || b.kind === "head")
      .map((b) => b.text),
  );
  const folded = all.filter((badge) => {
    const slash = badge.text.indexOf("/");
    return (
      badge.kind === "remote" &&
      slash > 0 &&
      locals.has(badge.text.slice(slash + 1))
    );
  });
  const foldedNames = new Set(folded.map((b) => b.text));
  return all
    .filter((badge) => !foldedNames.has(badge.text))
    .map((badge) => {
      const twin = folded.find((remote) =>
        remote.text.endsWith(`/${badge.text}`),
      );
      return twin && badge.kind !== "tag"
        ? { ...badge, remote: twin.text }
        : badge;
    });
}

const MAX_BADGE_CHARACTERS = 26;

/** Long ref names keep their start and end, so `feature/…/dark-mode` stays recognisable. */
export function shortenRef(text: string): string {
  const characters = Array.from(text);
  if (characters.length <= MAX_BADGE_CHARACTERS) return text;
  const half = Math.floor((MAX_BADGE_CHARACTERS - 1) / 2);
  return `${characters.slice(0, half).join("")}…${characters.slice(-half).join("")}`;
}
