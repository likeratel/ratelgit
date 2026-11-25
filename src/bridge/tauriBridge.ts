import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { BridgeError, type Bridge } from "./bridge";
import {
  actionSchema,
  addedProjectSchema,
  appErrorSchema,
  bootstrapSchema,
  removalPreviewSchema,
  removalResultSchema,
  removeOptionsSchema,
  worktreePlanSchema,
  chosenParentSchema,
  openResultSchema,
  commitInfoSchema,
  conflictDocumentSchema,
  fileDiffSchema,
  historyPageSchema,
  preferencesSchema,
  projectSchema,
  snapshotSchema,
  uiPreferencesSchema,
  worktreeSchema,
} from "./types";

/** Turns whatever a rejected `invoke` produced into a BridgeError. */
export function toBridgeError(raw: unknown): BridgeError {
  if (raw instanceof BridgeError) return raw;
  const parsed = appErrorSchema.safeParse(raw);
  if (parsed.success)
    return new BridgeError(parsed.data.kind, parsed.data.message);
  if (raw instanceof Error) return new BridgeError("unknown", raw.message);
  return new BridgeError("unknown", String(raw));
}

/** Validates a payload from the core; a mismatch is a contract violation. */
export function parsePayload<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  label: string,
): T {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new BridgeError(
    "invalid_response",
    `Unexpected response from ${label}: ${z.prettifyError(parsed.error)}`,
  );
}

async function call<T>(
  command: string,
  schema: z.ZodType<T>,
  args?: Record<string, unknown>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await invoke<unknown>(command, args);
  } catch (error) {
    throw toBridgeError(error);
  }
  return parsePayload(schema, raw, command);
}

const nothing = z
  .null()
  .or(z.undefined())
  .transform(() => undefined);

export function createTauriBridge(): Bridge {
  return {
    getBootstrap: () => call("get_bootstrap", bootstrapSchema),
    listProjects: () => call("list_projects", z.array(projectSchema)),
    addProject: () => call("add_project", addedProjectSchema),
    removeProject: (path) =>
      call("remove_project", z.array(z.string()), { path }),
    listWorktrees: (worktree) =>
      call("list_worktrees", z.array(worktreeSchema), { worktree }),
    loadWorktree: (worktree, filter) =>
      call("load_worktree", snapshotSchema, {
        worktree,
        filter: filter ? [...filter] : null,
      }),
    loadHistory: (worktree, filter, skip) =>
      call("load_history", historyPageSchema, {
        worktree,
        filter: filter ? [...filter] : null,
        skip,
      }),
    loadCommit: (worktree, hash) =>
      call("load_commit", commitInfoSchema, { worktree, hash }),
    loadDiff: (worktree, file, commit, ignoreWhitespace) =>
      call("load_diff", fileDiffSchema, {
        worktree,
        file,
        commit,
        ignoreWhitespace,
      }),
    loadConflict: (worktree, path) =>
      call("load_conflict", conflictDocumentSchema, { worktree, path }),
    openFile: (worktree, path) =>
      call("open_file", openResultSchema, { worktree, path }),
    planWorktree: (worktree, parent, folder, newBranch) =>
      call("plan_worktree", worktreePlanSchema, {
        worktree,
        parent,
        folder,
        newBranch,
      }),
    worktreeRemoval: (worktree, target) =>
      call("worktree_removal", removalPreviewSchema, { worktree, target }),
    removeWorktree: (worktree, target, options) =>
      call("remove_worktree", removalResultSchema, {
        worktree,
        target,
        options: removeOptionsSchema.parse(options),
      }),
    chooseWorktreeParent: () =>
      call("choose_worktree_parent", chosenParentSchema),
    runAction: (worktree, action) =>
      call("run_action", nothing, {
        worktree,
        action: actionSchema.parse(action),
      }),
    savePreferences: (filters, ui) =>
      call("save_preferences", preferencesSchema, {
        filters,
        ui: uiPreferencesSchema.parse(ui),
      }),
  };
}
