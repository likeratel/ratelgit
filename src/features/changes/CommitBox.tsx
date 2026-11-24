import { plural } from "../../lib/format";
import { formatShortcut, isMac } from "../../lib/shortcuts";
import { useApp } from "../../state/context";

export function CommitBox() {
  const draft = useApp((s) =>
    s.activePath ? (s.drafts[s.activePath] ?? "") : "",
  );
  const setDraft = useApp((s) => s.setDraft);
  const files = useApp((s) => s.files);
  const busy = useApp((s) => s.loading || s.mutation !== null);
  const execute = useApp((s) => s.execute);
  const platform = useApp((s) => s.platform);
  const staged = files.filter((f) => f.kind === "staged").length;
  const conflicted = files.some((f) => f.status === "U");
  const ready = !busy && staged > 0 && !conflicted && draft.trim().length > 0;
  const commit = () =>
    ready && void execute({ type: "commit", message: draft }, "Commit");
  const shortcut = formatShortcut(
    { code: "Enter", mod: true, shift: false, alt: false },
    isMac(platform),
  ).replace("Enter", "↩");
  return (
    <div className="commit-box">
      <textarea
        className="textarea"
        rows={3}
        placeholder="Commit message"
        aria-label="Commit message"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          const mod = isMac(platform) ? event.metaKey : event.ctrlKey;
          if (mod && event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
      <div className="commit-row-actions">
        <span className={conflicted ? "warn-text" : "muted"}>
          {conflicted
            ? "Resolve conflicts before committing"
            : plural(staged, "file") + " staged"}
        </span>
        <button
          type="button"
          className="button primary"
          disabled={!ready}
          onClick={commit}
          title={`Commit (${shortcut})`}
        >
          Commit
        </button>
      </div>
    </div>
  );
}
