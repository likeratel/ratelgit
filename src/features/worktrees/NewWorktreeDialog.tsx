import { useEffect, useMemo, useState } from "react";
import type { Reference, WorktreeBranch, WorktreePlan } from "../../bridge";
import {
  defaultStartPoint,
  folderNameFor,
  freeLocalBranches,
  remoteBranches,
  startPoints,
} from "../../lib/worktreeDialog";
import { useApp } from "../../state/context";
import { activeWorktree } from "../../state/helpers";
import { Modal } from "../../ui/Modal";
import { Segmented } from "../../ui/Segmented";
import { RefPicker, type PickerOption } from "./RefPicker";

type Mode = "new" | "existing";

const PLAN_DELAY_MS = 200;

function existingOptions(references: Reference[]): PickerOption[] {
  return [
    ...freeLocalBranches(references).map((r) => ({
      value: r.id,
      label: r.name,
      detail: "Local branch",
    })),
    ...remoteBranches(references).map((r) => ({
      value: r.id,
      label: r.name,
      detail: `Remote · creates ${r.name.replace(/^[^/]+\//, "")}`,
    })),
  ];
}

/** The branch the worktree gets, or null while the form is incomplete. */
function chosenBranch(
  mode: Mode,
  name: string,
  start: string,
  existing: string | null,
): WorktreeBranch | null {
  if (mode === "new")
    return name.trim()
      ? { type: "new", name: name.trim(), startPoint: start }
      : null;
  if (!existing) return null;
  return existing.startsWith("refs/remotes/")
    ? { type: "remote", reference: existing }
    : { type: "existing", reference: existing };
}

function branchLabel(branch: WorktreeBranch | null): string {
  if (!branch) return "";
  if (branch.type === "new") return branch.name;
  return branch.reference
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\/[^/]+\//, "");
}

function usePlan(folder: string, newBranch: string | null) {
  const planWorktree = useApp((s) => s.planWorktree);
  const parent = useApp((s) => s.worktreeParent?.token ?? null);
  const [plan, setPlan] = useState<WorktreePlan | null>(null);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      void planWorktree(parent, folder, newBranch).then(
        (next) => current && setPlan(next),
      );
    }, PLAN_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [planWorktree, parent, folder, newBranch]);
  return plan;
}

export function NewWorktreeDialog({ start }: { start: Reference | null }) {
  const references = useApp((s) => s.references);
  const parent = useApp((s) => s.worktreeParent);
  const project = useApp((s) =>
    s.projects.find((p) => p.path === s.projectPath),
  );
  const tree = useApp(activeWorktree);
  const close = useApp((s) => s.closeNewWorktree);
  const choose = useApp((s) => s.chooseWorktreeParent);
  const addWorktree = useApp((s) => s.addWorktree);
  const [mode, setMode] = useState<Mode>(start ? "existing" : "new");
  const [name, setName] = useState("");
  // Null until the user picks one: the default follows the refs, which may still be loading.
  const [pickedStart, setStartPoint] = useState<string | null>(null);
  const startPoint = pickedStart ?? defaultStartPoint(references);
  const [existing, setExisting] = useState<string | null>(start?.id ?? null);
  const [folder, setFolder] = useState<string | null>(null);
  const branch = chosenBranch(mode, name, startPoint, existing);
  const suggested = branch
    ? `${project?.name ?? "worktree"}-${folderNameFor(branchLabel(branch))}`
    : "";
  const folderName = folder ?? suggested;
  const plan = usePlan(folderName, mode === "new" ? name.trim() : null);
  const localTaken =
    mode === "new" &&
    references.some((r) => r.id === `refs/heads/${name.trim()}`);
  const branchError = localTaken
    ? `A branch named “${name.trim()}” already exists.`
    : name.trim()
      ? plan?.branchError
      : null;
  const folderError = folderName ? plan?.folderError : null;
  const starts = useMemo<PickerOption[]>(
    () => [
      {
        value: "HEAD",
        label: "HEAD",
        detail: `Current commit of ${tree?.branch ?? "this worktree"}`,
      },
      ...startPoints(references).map((r) => ({
        value: r.id,
        label: r.name,
        detail:
          r.kind === "tag"
            ? "Tag"
            : r.kind === "remote"
              ? "Remote branch"
              : "Branch",
      })),
    ],
    [references, tree?.branch],
  );
  const ready =
    branch !== null &&
    folderName.trim() !== "" &&
    plan?.path &&
    !branchError &&
    !folderError;
  return (
    <Modal
      label="New worktree"
      onClose={close}
      className="wide worktree-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && branch) void addWorktree(branch, folderName);
        }}
      >
        <div className="dialog-body">
          <h2>New Worktree</h2>
          <Segmented
            label="Branch"
            value={mode}
            onChange={setMode}
            options={[
              { value: "new", label: "New branch" },
              { value: "existing", label: "Existing branch" },
            ]}
          />
          {mode === "new" ? (
            <div className="dialog-fields">
              <label className="field">
                <span>Branch name</span>
                <input
                  className="input"
                  data-autofocus
                  value={name}
                  spellCheck={false}
                  placeholder="feature/new-idea"
                  aria-invalid={Boolean(branchError)}
                  onChange={(event) => setName(event.target.value)}
                />
                {branchError ? (
                  <span className="field-error">{branchError}</span>
                ) : null}
              </label>
              <div className="field">
                <span>
                  Start from{" "}
                  <span className="field-value">
                    {starts.find((o) => o.value === startPoint)?.label ??
                      startPoint}
                  </span>
                </span>
                <RefPicker
                  label="Start points"
                  options={starts}
                  value={startPoint}
                  onChange={setStartPoint}
                  testId="start-point"
                />
              </div>
            </div>
          ) : (
            <div className="field">
              <span>
                Branch{" "}
                <span className="field-value">
                  {existingOptions(references).find((o) => o.value === existing)
                    ?.label ?? "none chosen"}
                </span>
              </span>
              <RefPicker
                label="Branches"
                options={existingOptions(references)}
                value={existing}
                onChange={setExisting}
                testId="existing-branch"
              />
            </div>
          )}
          <label className="field">
            <span>Folder name</span>
            <input
              className="input"
              value={folderName}
              spellCheck={false}
              aria-invalid={Boolean(folderError)}
              onChange={(event) => setFolder(event.target.value)}
            />
            {folderError ? (
              <span className="field-error">{folderError}</span>
            ) : null}
          </label>
          <div className="prompt-folder">
            <span className="muted small-text">In</span>
            <span className="truncate prompt-folder-path" title={parent?.path}>
              {parent ? parent.path : "The folder that contains the project"}
            </span>
            <button
              type="button"
              className="button small"
              onClick={() => void choose()}
            >
              Choose Folder…
            </button>
          </div>
          <p className="path-preview" data-testid="worktree-path">
            {plan?.path ? (
              <>
                Creates <span className="mono selectable">{plan.path}</span>
              </>
            ) : (
              " "
            )}
          </p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!ready}>
            Add Worktree
          </button>
        </div>
      </form>
    </Modal>
  );
}
