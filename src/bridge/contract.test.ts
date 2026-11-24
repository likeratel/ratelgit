import { describe, expect, it } from "vitest";
import { z } from "zod";
import samples from "./fixtures/core-samples.json";
import requests from "./fixtures/requests.json";
import { createFakeBridge } from "./fake/fakeBridge";
import { WEB, WEB_LOGIN } from "./fake/world";
import * as types from "./types";

// Every response recorded from the real core (src-tauri/tests/contract.rs) must parse.
const schemas: Record<string, z.ZodType> = {
  get_bootstrap: z.array(types.bootstrapSchema),
  list_projects: z.array(types.projectSchema),
  add_project: z.array(types.addedProjectSchema),
  remove_project: z.array(z.string()),
  list_worktrees: z.array(types.worktreeSchema),
  load_worktree: z.array(types.snapshotSchema),
  load_history: types.historyPageSchema,
  load_commit: types.commitInfoSchema,
  load_diff: types.fileDiffSchema,
  load_conflict: z.array(types.conflictDocumentSchema),
  open_file: z.array(types.openResultSchema),
  choose_worktree_parent: z.array(types.chosenParentSchema),
  run_action: z.null(),
  save_preferences: types.preferencesSchema,
  error: types.appErrorSchema,
};

describe("contract with the core", () => {
  it("has a schema for every recorded command", () => {
    expect(Object.keys(samples).sort()).toEqual(Object.keys(schemas).sort());
  });

  for (const [command, schema] of Object.entries(schemas)) {
    it(`parses the real ${command} response`, () => {
      const parsed = schema.safeParse(
        (samples as Record<string, unknown>)[command],
      );
      expect(parsed.success ? "" : z.prettifyError(parsed.error)).toBe("");
    });
  }

  it("builds only actions the core accepts", () => {
    for (const action of requests.actions) {
      const parsed = types.actionSchema.safeParse(action);
      expect(parsed.success ? "" : z.prettifyError(parsed.error)).toBe("");
    }
    expect(types.uiPreferencesSchema.safeParse(requests.ui).success).toBe(true);
    const kinds = new Set(requests.actions.map((a) => a.type));
    const declared = types.actionSchema.options.map((o) => o.shape.type.value);
    expect([...kinds].sort()).toEqual([...new Set(declared)].sort());
  });
});

describe("fake core", () => {
  it("answers with payloads the schemas accept", async () => {
    const fake = createFakeBridge();
    expect(types.bootstrapSchema.parse(await fake.getBootstrap())).toBeTruthy();
    const projects = z
      .array(types.projectSchema)
      .parse(await fake.listProjects());
    expect(projects.map((p) => p.name)).toEqual(["ratel-web", "api-server"]);
    const snapshot = types.snapshotSchema.parse(
      await fake.loadWorktree(WEB, []),
    );
    const merge = snapshot.history.lines.find((l) => l.parents.length === 2);
    expect(merge).toBeTruthy();
    types.commitInfoSchema.parse(await fake.loadCommit(WEB, merge?.hash ?? ""));
    types.fileDiffSchema.parse(
      await fake.loadDiff(WEB, snapshot.files[0], null, false),
    );
    const stopped = types.snapshotSchema.parse(
      await fake.loadWorktree(WEB_LOGIN, []),
    );
    expect(stopped.operation?.conflicts).toBe(2);
    types.conflictDocumentSchema.parse(
      await fake.loadConflict(WEB_LOGIN, "src/session.ts"),
    );
  });

  it("filters history to the union of refs", async () => {
    const fake = createFakeBridge();
    const all = await fake.loadWorktree(WEB, []);
    const one = await fake.loadWorktree(WEB, ["refs/heads/fix/login-redirect"]);
    expect(one.history.lines.length).toBeLessThan(all.history.lines.length);
    expect(one.history.lines[0].subject).toBe("Redirect to home after login");
    expect(one.headHidden).toBe(true);
    const gone = await fake.loadWorktree(WEB, ["refs/heads/deleted"]);
    expect(gone.filter).toEqual([]);
  });
});
