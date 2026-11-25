import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { RemovalPreview, Worktree } from "../../bridge";
import {
  canRemove,
  changeRemoval,
  initialRemoval,
  removalWarnings,
  removeOptions,
  type RemovalChoices,
} from "../../lib/worktreeDialog";
import { useApp } from "../../state/context";
import { Modal } from "../../ui/Modal";

function Body({ preview }: { preview: RemovalPreview }) {
  const remove = useApp((s) => s.removeWorktree);
  const close = useApp((s) => s.closeRemoveWorktree);
  const [choices, setChoices] = useState<RemovalChoices>(() =>
    initialRemoval(preview),
  );
  const change = (next: Partial<RemovalChoices>) =>
    setChoices((current) =>
      next.acknowledged !== undefined
        ? { ...current, acknowledged: next.acknowledged }
        : changeRemoval(preview, current, next),
    );
  const warnings = removalWarnings(preview, choices);
  const allowed = canRemove(preview, choices);

  if (preview.isMain) {
    return (
      <>
        <div className="dialog-body">
          <h2>The Main Worktree Stays</h2>
          <p>
            The main worktree holds the project itself and cannot be removed.
            Remove the project from the list instead.
          </p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" autoFocus onClick={close}>
            Close
          </button>
        </div>
      </>
    );
  }

  const prunable = preview.prunable;
  return (
    <>
      <div className="dialog-body">
        <h2>{prunable ? "Clean Up Missing Worktree?" : "Remove Worktree?"}</h2>
        {prunable ? (
          <p>
            The folder <span className="mono selectable">{preview.path}</span>{" "}
            no longer exists. Git&apos;s record of it is removed; branches are
            kept.
          </p>
        ) : (
          <>
            <p>
              The folder <span className="mono selectable">{preview.path}</span>{" "}
              and everything in it will be deleted.{" "}
              {preview.branch ? (
                <>
                  It has <strong>{preview.branch}</strong> checked out.
                </>
              ) : (
                "It has a detached HEAD."
              )}
            </p>
            <div className="removal-options">
              {preview.branch ? (
                <label
                  className={`checkbox${preview.branchBlock ? " disabled" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={choices.deleteBranch && !preview.branchBlock}
                    disabled={Boolean(preview.branchBlock)}
                    onChange={(event) =>
                      change({
                        deleteBranch: event.target.checked,
                        deleteRemote:
                          event.target.checked && choices.deleteRemote,
                      })
                    }
                  />
                  <span>
                    Also delete local branch <strong>{preview.branch}</strong>
                    {preview.branchBlock ? (
                      <span className="option-note">{preview.branchBlock}</span>
                    ) : null}
                  </span>
                </label>
              ) : null}
              {preview.upstream && preview.branch ? (
                <label
                  className={`checkbox${preview.remoteBlock ? " disabled" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={choices.deleteRemote}
                    disabled={
                      !choices.deleteBranch ||
                      Boolean(preview.branchBlock) ||
                      Boolean(preview.remoteBlock)
                    }
                    onChange={(event) =>
                      change({ deleteRemote: event.target.checked })
                    }
                  />
                  <span>
                    Also delete remote branch{" "}
                    <strong>
                      {preview.upstream.remote}/{preview.upstream.name}
                    </strong>
                    <span className="option-note">
                      {preview.remoteBlock ??
                        "Deletes it from the shared remote repository, for everyone who uses it."}
                    </span>
                  </span>
                </label>
              ) : null}
            </div>
            {warnings.length ? (
              <div className="removal-warnings" role="alert">
                <TriangleAlert size={15} />
                <div>
                  <ul>
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={choices.acknowledged}
                      onChange={(event) =>
                        change({ acknowledged: event.target.checked })
                      }
                    />
                    I understand these will be lost
                  </label>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="dialog-actions">
        {/* The preview arrives after the dialog opens, so focus is set here, not by Modal. */}
        <button type="button" className="button" autoFocus onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="button primary danger"
          disabled={!allowed}
          onClick={() => void remove(removeOptions(preview, choices))}
        >
          {prunable ? "Clean Up" : "Remove Worktree"}
        </button>
      </div>
    </>
  );
}

export function RemoveWorktreeDialog({
  tree,
  preview,
}: {
  tree: Worktree;
  preview: RemovalPreview | null;
}) {
  const close = useApp((s) => s.closeRemoveWorktree);
  return (
    <Modal
      label={`Remove worktree ${tree.name}`}
      onClose={close}
      className="wide"
    >
      {preview ? (
        <Body preview={preview} />
      ) : (
        <div className="dialog-body">
          <h2>Remove Worktree?</h2>
          <p>
            <span className="spinner" /> Checking {tree.name}…
          </p>
        </div>
      )}
    </Modal>
  );
}
