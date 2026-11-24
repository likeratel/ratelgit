import { Check, Globe, Tag } from "lucide-react";
import { badgesFor, shortenRef, type Badge } from "../../lib/badges";

const VISIBLE = 3;

function BadgeView({ badge }: { badge: Badge }) {
  const title = badge.remote
    ? `${badge.text}, same commit as ${badge.remote}`
    : badge.text;
  return (
    <span className={`ref-badge ${badge.kind}`} title={title}>
      {badge.kind === "head" ? <Check size={10} strokeWidth={3} /> : null}
      {badge.kind === "tag" ? <Tag size={10} strokeWidth={2.5} /> : null}
      {badge.kind === "remote" ? <Globe size={10} strokeWidth={2.5} /> : null}
      <span>{shortenRef(badge.text)}</span>
      {badge.remote ? (
        <Globe size={10} strokeWidth={2.5} className="twin" />
      ) : null}
    </span>
  );
}

export function Badges({
  refs,
  remotes,
}: {
  refs: string[];
  remotes: ReadonlySet<string>;
}) {
  if (refs.length === 0) return null;
  const badges = badgesFor(refs, remotes);
  const hidden = badges.slice(VISIBLE);
  return (
    <span className="badges">
      {badges.slice(0, VISIBLE).map((badge) => (
        <BadgeView key={`${badge.kind}:${badge.text}`} badge={badge} />
      ))}
      {hidden.length ? (
        <span
          className="badge-more"
          title={hidden.map((b) => b.text).join(", ")}
        >
          +{hidden.length}
        </span>
      ) : null}
    </span>
  );
}
