import type {
  Action,
  Bridge,
  ChosenParent,
  ChangedFile,
  ChunkChoice,
  CommitInfo,
  CommitLine,
  ConflictDocument,
  FileDiff,
  OperationState,
  Platform,
  Project,
  Reference,
  Tracking,
  UiPreferences,
} from "../bridge";

export type Mode = "history" | "changes";

export interface ProjectView extends Omit<Project, "state"> {
  state: Project["state"] | "loading";
}

export interface HistoryState {
  lines: CommitLine[];
  complete: boolean;
  headHidden: boolean;
  /** Identifies one listing; pages for an older listing are dropped. */
  token: number;
}

/** A file shown in the diff area, with whatever has loaded for it so far. */
export interface FileView {
  file: ChangedFile;
  /** Commit the file belongs to, for committed files. */
  commit: string | null;
  diff: FileDiff | null;
  conflict: ConflictDocument | null;
  choices: (ChunkChoice | null)[];
  loading: boolean;
  /** Why nothing can be shown, e.g. content a partial clone has not downloaded. */
  unavailable: string | null;
}

export interface Confirmation {
  title: string;
  message: string;
  confirm: string;
  label: string;
  action: Action;
  destructive: boolean;
}

export type PromptKind =
  "createBranch" | "stash" | "rename" | "addWorktree" | "mergeMessage";

export interface Prompt {
  kind: PromptKind;
  title: string;
  message: string;
  placeholder: string;
  confirm: string;
  initial: string;
  multiline: boolean;
  reference: Reference | null;
  operation: OperationState | null;
}

export interface Data {
  bridge: Bridge;
  ready: boolean;
  platform: Platform;
  projects: ProjectView[];
  projectPath: string | null;
  activePath: string | null;
  references: Reference[];
  /** What the default History filter resolves to for the selected worktree. */
  defaultFilter: string[];
  history: HistoryState;
  files: ChangedFile[];
  tracking: Tracking | null;
  operation: OperationState | null;
  loading: boolean;
  loadingPage: boolean;
  /** Label of the action that is running, e.g. "Stage". */
  mutation: string | null;
  error: string | null;
  /** Information that is not an error, e.g. a file shown in the file manager. */
  notice: string | null;
  filters: Record<string, string[]>;
  drafts: Record<string, string>;
  mode: Mode;
  commit: { hash: string; info: CommitInfo | null } | null;
  historyFile: FileView | null;
  changesFile: FileView | null;
  ui: UiPreferences;
  confirmation: Confirmation | null;
  prompt: Prompt | null;
  switcherOpen: boolean;
  /** Folder picked in the core for the next new worktree. */
  worktreeParent: ChosenParent;
}

export interface Operations {
  init(): Promise<void>;
  loadProjects(): Promise<void>;
  addProject(): Promise<void>;
  removeProject(path: string): Promise<void>;
  selectProject(path: string): void;
  selectWorktree(path: string): void;
  moveWorktree(offset: 1 | -1): void;
  refresh(): void;
  setMode(mode: Mode): void;
  loadMoreHistory(): Promise<void>;
  toggleFilter(ids: readonly string[]): void;
  removeFromFilter(id: string): void;
  /** Shows every branch ("Show All"). */
  clearFilter(): void;
  /** Goes back to the default filter ("Default"). */
  resetFilter(): void;
  toggleCurrentBranchOnly(): void;
  filterTo(id: string): void;
  selectCommit(hash: string | null): Promise<void>;
  reveal(reference: Reference): void;
  selectFile(file: ChangedFile): Promise<void>;
  chooseChunk(chunk: number, choice: ChunkChoice): void;
  reloadConflict(): void;
  setDraft(text: string): void;
  execute(action: Action, label: string): Promise<void>;
  confirm(confirmation: Confirmation): void;
  runConfirmation(): void;
  dismissConfirmation(): void;
  ask(prompt: Prompt): void;
  submitPrompt(text: string): void;
  dismissPrompt(): void;
  dismissError(): void;
  setSwitcherOpen(open: boolean): void;
  updateUi(change: Partial<UiPreferences>): void;
  openFile(path: string): Promise<void>;
  chooseWorktreeParent(): Promise<void>;
  /** Re-reads the worktree without disturbing selection, drafts or loaded pages. */
  refreshQuietly(): Promise<void>;
  dismissNotice(): void;
}

export type AppState = Data & Operations;
export type SetState = (
  partial: Partial<AppState> | ((state: AppState) => Partial<AppState>),
) => void;
export type GetState = () => AppState;
