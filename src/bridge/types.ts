import { z } from "zod";

// Zod schemas for every payload in CONTRACT.md. Everything that crosses the bridge is parsed
// with these before the UI uses it. Objects are strict, so an unexpected field from the core
// fails loudly instead of being ignored.

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();

export const platformSchema = z.enum(["macos", "windows", "linux"]);

export const worktreeSchema = z.strictObject({
  path: z.string(),
  name: z.string(),
  branch: nullable(z.string()),
  isMain: z.boolean(),
  unavailable: z.boolean(),
  changes: nullable(z.number().int()),
  ahead: nullable(z.number().int()),
  behind: nullable(z.number().int()),
});

export const projectSchema = z.strictObject({
  path: z.string(),
  name: z.string(),
  state: z.enum(["ready", "unavailable"]),
  reason: nullable(z.string()),
  worktrees: z.array(worktreeSchema),
});

export const refKindSchema = z.enum(["local", "remote", "tag", "stash"]);

export const referenceSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: refKindSchema,
  target: nullable(z.string()),
  isHead: z.boolean(),
  worktreePath: nullable(z.string()),
  subject: nullable(z.string()),
});

export const commitLineSchema = z.strictObject({
  index: z.number().int(),
  hash: z.string(),
  shortHash: z.string(),
  subject: z.string(),
  author: z.string(),
  date: z.string(),
  timestamp: z.number(),
  refs: z.array(z.string()),
  parents: z.array(z.string()),
});

export const historyPageSchema = z.strictObject({
  lines: z.array(commitLineSchema),
  complete: z.boolean(),
});

export const changeKindSchema = z.enum([
  "staged",
  "unstaged",
  "untracked",
  "committed",
]);
export const conflictKindSchema = z.enum([
  "bothModified",
  "bothAdded",
  "bothDeleted",
  "addedByUs",
  "addedByThem",
  "deletedByUs",
  "deletedByThem",
]);

export const changedFileSchema = z.strictObject({
  path: z.string(),
  kind: changeKindSchema,
  status: z.string(),
  conflict: nullable(conflictKindSchema),
});

export const operationSchema = z.enum([
  "merge",
  "rebase",
  "cherryPick",
  "revert",
]);

export const operationStateSchema = z.strictObject({
  kind: operationSchema,
  ours: nullable(z.string()),
  theirs: nullable(z.string()),
  branch: nullable(z.string()),
  step: nullable(z.number().int()),
  total: nullable(z.number().int()),
  conflicts: z.number().int(),
  message: nullable(z.string()),
});

export const trackingSchema = z.strictObject({
  branch: z.string(),
  remote: z.string(),
  target: z.string(),
  ahead: z.number().int(),
  behind: z.number().int(),
});

export const snapshotSchema = z.strictObject({
  references: z.array(referenceSchema),
  filter: z.array(z.string()),
  history: historyPageSchema,
  headHidden: z.boolean(),
  files: z.array(changedFileSchema),
  tracking: nullable(trackingSchema),
  operation: nullable(operationStateSchema),
});

export const commitInfoSchema = z.strictObject({
  detail: z.strictObject({
    hash: z.string(),
    parents: z.array(z.string()),
    author: z.string(),
    email: z.string(),
    date: z.string(),
    message: z.string(),
  }),
  files: z.array(changedFileSchema),
});

export const fileDiffSchema = z.strictObject({
  text: z.string(),
  lossy: z.boolean(),
  truncated: z.boolean(),
});

export const segmentSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), lines: z.array(z.string()) }),
  z.strictObject({
    type: z.literal("conflict"),
    oursLabel: z.string(),
    baseLabel: nullable(z.string()),
    theirsLabel: z.string(),
    ours: z.array(z.string()),
    base: nullable(z.array(z.string())),
    theirs: z.array(z.string()),
  }),
]);

export const conflictDocumentSchema = z.strictObject({
  path: z.string(),
  state: z.enum([
    "ready",
    "noMarkers",
    "malformed",
    "binary",
    "notUtf8",
    "tooLarge",
    "missing",
  ]),
  reason: nullable(z.string()),
  fingerprint: nullable(z.string()),
  segments: z.array(segmentSchema),
});

export const openResultSchema = z.strictObject({
  action: z.enum(["opened", "revealed"]),
});

export const chosenParentSchema = z
  .strictObject({ token: z.string(), path: z.string() })
  .nullable();

/** History filters hold at most this many refs (the core refuses more). */
export const MAX_FILTER_REFS = 200;

export const SIDEBAR_WIDTH = { min: 220, default: 272, max: 420 } as const;
export const SPLIT_RANGE = { min: 0.2, max: 0.8 } as const;

export const uiPreferencesSchema = z.strictObject({
  diffLayout: z.enum(["unified", "split"]),
  ignoreWhitespace: z.boolean(),
  sidebarWidth: z.number().int().min(SIDEBAR_WIDTH.min).max(SIDEBAR_WIDTH.max),
  historySplit: z.number().min(SPLIT_RANGE.min).max(SPLIT_RANGE.max),
  changesSplit: z.number().min(SPLIT_RANGE.min).max(SPLIT_RANGE.max),
  lastWorktree: nullable(z.string()),
});

export const preferencesSchema = z.strictObject({
  version: z.literal(1),
  projects: z.array(z.string()),
  filters: z.record(z.string(), z.array(z.string())),
  ui: uiPreferencesSchema,
});

export const bootstrapSchema = z.strictObject({
  preferences: preferencesSchema,
  platform: platformSchema,
});

export const addedProjectSchema = z
  .strictObject({
    projects: z.array(projectSchema),
    worktree: nullable(z.string()),
  })
  .nullable();

export const errorKindSchema = z.enum([
  "invalid_input",
  "git_missing",
  "git_too_old",
  "not_found",
  "git_failed",
  "stale",
  "not_fully_merged",
  "conflict_markers",
  "io",
  "missing_objects",
]);

export const appErrorSchema = z.strictObject({
  kind: errorKindSchema,
  message: z.string(),
});

const fileArg = changedFileSchema;
const ref = z.string().startsWith("refs/");
const stashArg = { stash: z.string(), revision: z.string() };
export const chunkChoiceSchema = z.enum([
  "ours",
  "theirs",
  "oursThenTheirs",
  "theirsThenOurs",
]);

export const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("stage"), file: fileArg }),
  z.strictObject({ type: z.literal("unstage"), file: fileArg }),
  z.strictObject({ type: z.literal("discard"), file: fileArg }),
  z.strictObject({
    type: z.literal("applyLines"),
    file: fileArg,
    source: z.string(),
    lines: z.array(z.number().int().nonnegative()),
    operation: z.enum(["stage", "unstage", "discard"]),
  }),
  z.strictObject({ type: z.literal("commit"), message: z.string() }),
  z.strictObject({ type: z.literal("createBranch"), name: z.string() }),
  z.strictObject({ type: z.literal("switchBranch"), reference: ref }),
  z.strictObject({ type: z.literal("checkoutRemote"), reference: ref }),
  z.strictObject({
    type: z.literal("renameBranch"),
    reference: ref,
    name: z.string(),
  }),
  z.strictObject({
    type: z.literal("deleteBranch"),
    reference: ref,
    force: z.boolean(),
  }),
  z.strictObject({ type: z.literal("merge"), reference: ref }),
  z.strictObject({ type: z.literal("rebase"), reference: ref }),
  z.strictObject({
    type: z.literal("addWorktree"),
    reference: ref,
    parent: z.string().nullable(),
    name: z.string(),
  }),
  z.strictObject({ type: z.literal("stash"), message: z.string() }),
  z.strictObject({ type: z.literal("applyStash"), ...stashArg }),
  z.strictObject({ type: z.literal("dropStash"), ...stashArg }),
  z.strictObject({ type: z.literal("abort"), operation: operationSchema }),
  z.strictObject({
    type: z.literal("continue"),
    operation: operationSchema,
    message: z.string().nullable(),
  }),
  z.strictObject({
    type: z.literal("resolveSide"),
    file: fileArg,
    side: z.enum(["ours", "theirs"]),
  }),
  z.strictObject({ type: z.literal("keepFile"), file: fileArg }),
  z.strictObject({ type: z.literal("deleteFile"), file: fileArg }),
  z.strictObject({
    type: z.literal("markResolved"),
    file: fileArg,
    force: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("saveResolution"),
    file: fileArg,
    fingerprint: z.string(),
    choices: z.array(chunkChoiceSchema),
  }),
  z.strictObject({ type: z.literal("fetch") }),
  z.strictObject({ type: z.literal("pull") }),
  z.strictObject({ type: z.literal("push") }),
]);

export type Platform = z.infer<typeof platformSchema>;
export type Worktree = z.infer<typeof worktreeSchema>;
export type Project = z.infer<typeof projectSchema>;
export type RefKind = z.infer<typeof refKindSchema>;
export type Reference = z.infer<typeof referenceSchema>;
export type CommitLine = z.infer<typeof commitLineSchema>;
export type HistoryPage = z.infer<typeof historyPageSchema>;
export type ChangeKind = z.infer<typeof changeKindSchema>;
export type ConflictKind = z.infer<typeof conflictKindSchema>;
export type ChangedFile = z.infer<typeof changedFileSchema>;
export type Operation = z.infer<typeof operationSchema>;
export type OperationState = z.infer<typeof operationStateSchema>;
export type Tracking = z.infer<typeof trackingSchema>;
export type WorktreeSnapshot = z.infer<typeof snapshotSchema>;
export type CommitInfo = z.infer<typeof commitInfoSchema>;
export type FileDiff = z.infer<typeof fileDiffSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type ConflictDocument = z.infer<typeof conflictDocumentSchema>;
export type ChunkChoice = z.infer<typeof chunkChoiceSchema>;
export type UiPreferences = z.infer<typeof uiPreferencesSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type Bootstrap = z.infer<typeof bootstrapSchema>;
export type AddedProject = z.infer<typeof addedProjectSchema>;
export type ErrorKind = z.infer<typeof errorKindSchema>;
export type Action = z.infer<typeof actionSchema>;
export type OpenResult = z.infer<typeof openResultSchema>;
export type ChosenParent = z.infer<typeof chosenParentSchema>;
