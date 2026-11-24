import { CircleCheck, TriangleAlert } from "lucide-react";
import { OPERATION_NAMES, operationTitle } from "../../lib/conflict";
import { plural } from "../../lib/format";
import { useApp } from "../../state/context";
import { abortConfirmation, mergeMessagePrompt } from "../../state/dialogs";

/** Shows a stopped merge, rebase, cherry-pick or revert with Continue and Abort. */
export function OperationBanner() {
  const operation = useApp((s) => s.operation);
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const busy = useApp((s) => s.mutation !== null || s.loading);
  const confirm = useApp((s) => s.confirm);
  const ask = useApp((s) => s.ask);
  const execute = useApp((s) => s.execute);
  if (!operation) return null;
  const name = OPERATION_NAMES[operation.kind];
  const resolved = operation.conflicts === 0;
  const proceed = () => {
    if (operation.kind === "merge") ask(mergeMessagePrompt(operation));
    else
      void execute(
        { type: "continue", operation: operation.kind, message: null },
        `Continue ${name}`,
      );
  };
  return (
    <div
      className={`operation-banner${resolved ? " resolved" : ""}`}
      role="status"
      data-testid="operation-banner"
    >
      {resolved ? (
        <CircleCheck size={16} className="banner-icon ok" />
      ) : (
        <TriangleAlert size={16} className="banner-icon" />
      )}
      <div className="banner-text">
        <strong className="truncate">{operationTitle(operation)}</strong>
        <span className="muted">
          {resolved
            ? `All conflicts are resolved. ${operation.kind === "merge" ? "Commit the merge" : `Continue the ${name.toLowerCase()}`} when ready.`
            : `${plural(operation.conflicts, "conflicted file")} left. Resolve each one in Changes and it is staged for you.`}
        </span>
      </div>
      <div className="banner-actions">
        {mode !== "changes" ? (
          <button
            type="button"
            className="button small"
            onClick={() => setMode("changes")}
          >
            Show Conflicts
          </button>
        ) : null}
        <button
          type="button"
          className="button small danger"
          disabled={busy}
          onClick={() => confirm(abortConfirmation(operation))}
        >
          Abort {name}…
        </button>
        <button
          type="button"
          className="button small primary"
          disabled={busy || !resolved}
          title={
            resolved
              ? undefined
              : "Resolve and stage every conflicted file first"
          }
          onClick={proceed}
        >
          {operation.kind === "merge" ? "Commit Merge…" : `Continue ${name}`}
        </button>
      </div>
    </div>
  );
}
