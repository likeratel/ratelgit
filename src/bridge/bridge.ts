import type {
  Action,
  ChosenParent,
  OpenResult,
  AddedProject,
  Bootstrap,
  ChangedFile,
  CommitInfo,
  ConflictDocument,
  ErrorKind,
  FileDiff,
  HistoryPage,
  Preferences,
  Project,
  UiPreferences,
  Worktree,
  WorktreeSnapshot,
} from "./types";

/** Everything the web UI may ask of the core. See CONTRACT.md. */
export interface Bridge {
  getBootstrap(): Promise<Bootstrap>;
  listProjects(): Promise<Project[]>;
  addProject(): Promise<AddedProject>;
  removeProject(path: string): Promise<string[]>;
  listWorktrees(worktree: string): Promise<Worktree[]>;
  loadWorktree(
    worktree: string,
    filter: readonly string[],
  ): Promise<WorktreeSnapshot>;
  loadHistory(
    worktree: string,
    filter: readonly string[],
    skip: number,
  ): Promise<HistoryPage>;
  loadCommit(worktree: string, hash: string): Promise<CommitInfo>;
  loadDiff(
    worktree: string,
    file: ChangedFile,
    commit: string | null,
    ignoreWhitespace: boolean,
  ): Promise<FileDiff>;
  loadConflict(worktree: string, path: string): Promise<ConflictDocument>;
  openFile(worktree: string, path: string): Promise<OpenResult>;
  chooseWorktreeParent(): Promise<ChosenParent>;
  runAction(worktree: string, action: Action): Promise<void>;
  savePreferences(
    filters: Record<string, readonly string[]>,
    ui: UiPreferences,
  ): Promise<Preferences>;
}

export type BridgeErrorKind = ErrorKind | "invalid_response" | "unknown";

/** Rejected value of every bridge call, mirroring the contract's AppError. */
export class BridgeError extends Error {
  readonly kind: BridgeErrorKind;

  constructor(kind: BridgeErrorKind, message: string) {
    super(message);
    this.name = "BridgeError";
    this.kind = kind;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function errorKind(error: unknown): BridgeErrorKind {
  return error instanceof BridgeError ? error.kind : "unknown";
}
