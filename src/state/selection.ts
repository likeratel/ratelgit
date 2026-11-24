import {
  errorKind,
  errorMessage,
  type Bridge,
  type ChangedFile,
} from "../bridge";
import { choose, emptyChoices } from "../lib/conflict";
import { describe } from "./helpers";
import type { Tokens } from "./tokens";
import type { FileView, GetState, Operations, SetState } from "./types";

type SelectionOps = Pick<
  Operations,
  "selectCommit" | "reveal" | "selectFile" | "chooseChunk" | "reloadConflict"
> & {
  /** Shows `file` without the busy check, for refreshes after an action. `quiet` keeps the
   * current view on screen until the new one has loaded. */
  showFile(file: ChangedFile, quiet?: boolean): Promise<void>;
};

const slotOf = (file: ChangedFile) =>
  file.kind === "committed" ? "historyFile" : "changesFile";
const channelOf = (file: ChangedFile) =>
  file.kind === "committed" ? "history" : "changes";

export function selectionOperations(
  set: SetState,
  get: GetState,
  bridge: Bridge,
  tokens: Tokens,
): SelectionOps {
  /** Loads the diff, or the conflict document for an unmerged file, into its slot. */
  const showFile = async (
    file: ChangedFile,
    commit: string | null,
    quiet = false,
  ) => {
    const path = get().activePath;
    if (!path) return;
    const slot = slotOf(file);
    const channel = channelOf(file);
    const token = tokens.next(channel);
    const previous = get()[slot];
    const keep =
      quiet &&
      previous !== null &&
      previous.file.path === file.path &&
      previous.file.kind === file.kind;
    const view: FileView =
      keep && previous
        ? { ...previous, file, loading: true }
        : {
            file,
            commit,
            diff: null,
            conflict: null,
            choices: [],
            loading: true,
            unavailable: null,
          };
    set({ [slot]: view });
    const update = (change: Partial<FileView>) => {
      if (!tokens.current(channel, token) || get().activePath !== path) return;
      const current = get()[slot];
      if (current) set({ [slot]: { ...current, ...change, loading: false } });
    };
    try {
      if (file.status === "U" && file.kind !== "committed") {
        const conflict = await bridge.loadConflict(path, file.path);
        const unchanged =
          keep && previous?.conflict?.fingerprint === conflict.fingerprint;
        // Choices made while the file was being read again are kept.
        const current = get()[slot];
        update({
          conflict,
          diff: null,
          unavailable: null,
          choices:
            unchanged && current
              ? current.choices
              : emptyChoices(conflict.segments),
        });
      } else {
        const diff = await bridge.loadDiff(
          path,
          file,
          commit,
          get().ui.ignoreWhitespace,
        );
        update({ diff, conflict: null, choices: [], unavailable: null });
      }
    } catch (error) {
      // Content a partial clone has not downloaded, or a failure while re-reading after an
      // action, is shown in the diff area; it must not replace the action's own message.
      const inPlace = quiet || errorKind(error) === "missing_objects";
      update({ diff: null, unavailable: errorMessage(error) });
      if (!inPlace && tokens.current(channel, token))
        set({ error: describe("Reading the diff", error) });
    }
  };

  const selectCommit = async (hash: string | null) => {
    const path = get().activePath;
    if (!path || get().mutation) return;
    const token = tokens.next("history");
    set({ commit: hash ? { hash, info: null } : null, historyFile: null });
    if (!hash) return;
    try {
      const info = await bridge.loadCommit(path, hash);
      if (!tokens.current("history", token) || get().activePath !== path)
        return;
      set({ commit: { hash, info } });
      const first = info.files[0];
      if (first) await showFile(first, hash);
    } catch (error) {
      if (tokens.current("history", token))
        set({ error: describe("Reading the commit", error) });
    }
  };

  return {
    showFile: (file, quiet = false) =>
      showFile(
        file,
        file.kind === "committed" ? (get().commit?.hash ?? null) : null,
        quiet,
      ),

    selectCommit,

    reveal(reference) {
      if (!reference.target) return;
      set({ mode: "history" });
      void selectCommit(reference.target);
    },

    async selectFile(file) {
      if (get().mutation) return;
      const commit =
        file.kind === "committed" ? (get().commit?.hash ?? null) : null;
      await showFile(file, commit);
    },

    chooseChunk(chunk, choice) {
      const view = get().changesFile;
      if (!view?.conflict) return;
      set({
        changesFile: { ...view, choices: choose(view.choices, chunk, choice) },
      });
    },

    reloadConflict() {
      const view = get().changesFile;
      if (view) void showFile(view.file, null);
    },
  };
}
