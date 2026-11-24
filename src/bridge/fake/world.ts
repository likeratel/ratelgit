/** Initial state of the fake core: two projects with worktrees, refs, changes and a conflict. */

import { BridgeError } from "../bridge";
import { diffKey } from "./diffs";
import type {
  ChangedFile,
  ConflictDocument,
  OperationState,
  Preferences,
  Reference,
  Tracking,
} from "../types";
import { apiCommits, webCommits, webHash, type FakeCommit } from "./history";

export const WEB = "/work/ratel-web";
export const WEB_DARK = "/work/ratel-web-dark";
export const WEB_LOGIN = "/work/ratel-web-login";
export const API = "/work/api-server";

export interface FakeTree {
  path: string;
  branch: string | null;
  head: string;
  files: ChangedFile[];
  tracking: Tracking | null;
  operation: OperationState | null;
}

export interface FakeProject {
  path: string;
  commits: FakeCommit[];
  refs: Reference[];
  trees: FakeTree[];
}

export interface FakeWorld {
  projects: FakeProject[];
  diffs: Record<string, string>;
  conflicts: Record<string, ConflictDocument>;
  preferences: Preferences;
}

const file = (
  path: string,
  kind: ChangedFile["kind"],
  status: string,
  conflict: ChangedFile["conflict"] = null,
): ChangedFile => ({ path, kind, status, conflict });

const ref = (
  id: string,
  target: string,
  extra: Partial<Reference> = {},
): Reference => {
  const kind = id.startsWith("refs/heads/")
    ? "local"
    : id.startsWith("refs/remotes/")
      ? "remote"
      : id.startsWith("refs/tags/")
        ? "tag"
        : "stash";
  const name = id.replace(/^refs\/(heads|remotes|tags)\//, "");
  return {
    id,
    name,
    kind,
    target,
    isHead: false,
    worktreePath: null,
    subject: null,
    ...extra,
  };
};

const sessionLines = Array.from(
  { length: 24 },
  (_, i) => `export const line${i + 1} = ${i + 1};`,
);

function sessionDiff(): string {
  const context = (from: number, to: number) =>
    sessionLines.slice(from - 1, to).map((l) => ` ${l}`);
  return [
    "diff --git a/src/session.ts b/src/session.ts",
    "index 3b18e51..9a1f0c2 100644",
    "--- a/src/session.ts",
    "+++ b/src/session.ts",
    "@@ -1,6 +1,6 @@",
    ...context(1, 2),
    "-export const line3 = 3;",
    "+export const line3 = compute(3);",
    ...context(4, 6),
    "@@ -17,7 +17,7 @@ export const line16 = 16;",
    ...context(17, 19),
    "-export const line20 = 20;",
    "+export const line20 = 20 * scale;",
    ...context(21, 23),
    "",
  ].join("\n");
}

const NEW_FILE = (path: string, lines: string[]) =>
  [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..5d1c0b9",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
    "",
  ].join("\n");

function webRefs(): Reference[] {
  const h = webHash;
  return [
    ref("refs/heads/feature/auth/oauth", h("web-scope")),
    ref("refs/heads/feature/ui/dark-mode", h("web-dark"), {
      worktreePath: WEB_DARK,
    }),
    ref("refs/heads/fix/login-redirect", h("web-redirect"), {
      worktreePath: WEB_LOGIN,
    }),
    ref("refs/heads/main", h("web-docs"), { isHead: true, worktreePath: WEB }),
    ref("refs/remotes/origin/feature/auth/oauth", h("web-scope")),
    ref("refs/remotes/origin/feature/ui/dark-mode", h("web-dark")),
    ref("refs/remotes/origin/fix/login-redirect", h("web-redirect")),
    ref("refs/remotes/origin/main", h("web-docs")),
    ref("refs/tags/v0.2.0", h("web-store")),
    ref("refs/tags/v0.3.0", h("web-merge")),
    ref("stash@{0}", h("web-stash"), {
      subject: "On main: Try a denser header",
    }),
  ];
}

const conflictState: OperationState = {
  kind: "merge",
  ours: "fix/login-redirect",
  theirs: "main",
  branch: null,
  step: null,
  total: null,
  conflicts: 2,
  message: "Merge branch 'main' into fix/login-redirect",
};

const sessionConflict: ConflictDocument = {
  path: "src/session.ts",
  state: "ready",
  reason: null,
  fingerprint: "a1b2c3d4e5f60718-412",
  segments: [
    {
      type: "text",
      lines: [
        'import { cookieName } from "./cookie";\n',
        "\n",
        "export function redirectAfterLogin(user: User) {\n",
      ],
    },
    {
      type: "conflict",
      oursLabel: "HEAD",
      baseLabel: null,
      theirsLabel: "main",
      ours: ['  return user.home ?? "/";\n'],
      base: null,
      theirs: ['  return user.returnTo ?? "/dashboard";\n'],
    },
    {
      type: "text",
      lines: ["}\n", "\n", "export function sessionTimeout() {\n"],
    },
    {
      type: "conflict",
      oursLabel: "HEAD",
      baseLabel: null,
      theirsLabel: "main",
      ours: ["  const minutes = 30;\n", "  return minutes * 60;\n"],
      base: null,
      theirs: ["  return settings.sessionMinutes * 60;\n"],
    },
    { type: "text", lines: ["}\n"] },
  ],
};

export function createWorld(): FakeWorld {
  const h = webHash;
  const web: FakeProject = {
    path: WEB,
    commits: webCommits,
    refs: webRefs(),
    trees: [
      {
        path: WEB,
        branch: "main",
        head: h("web-docs"),
        files: [
          file("src/session.ts", "unstaged", "M"),
          file("notes.txt", "untracked", "?"),
          file("src/retry.ts", "staged", "A"),
        ],
        tracking: {
          branch: "main",
          remote: "origin",
          target: "refs/heads/main",
          ahead: 0,
          behind: 0,
        },
        operation: null,
      },
      {
        path: WEB_DARK,
        branch: "feature/ui/dark-mode",
        head: h("web-dark"),
        files: [file("src/theme.css", "unstaged", "M")],
        tracking: {
          branch: "feature/ui/dark-mode",
          remote: "origin",
          target: "refs/heads/feature/ui/dark-mode",
          ahead: 0,
          behind: 0,
        },
        operation: null,
      },
      {
        path: WEB_LOGIN,
        branch: "fix/login-redirect",
        head: h("web-redirect"),
        files: [
          file("src/session.ts", "unstaged", "U", "bothModified"),
          file("docs/legacy.md", "unstaged", "U", "deletedByThem"),
          file("README.md", "staged", "M"),
        ],
        tracking: null,
        operation: conflictState,
      },
    ],
  };
  const apiHead = apiCommits[0].hash;
  const api: FakeProject = {
    path: API,
    commits: apiCommits,
    refs: [
      ref("refs/heads/main", apiHead, { isHead: true, worktreePath: API }),
      ref("refs/remotes/origin/main", apiCommits[3].hash),
    ],
    trees: [
      {
        path: API,
        branch: "main",
        head: apiHead,
        files: [file("src/limits.ts", "unstaged", "M")],
        tracking: {
          branch: "main",
          remote: "origin",
          target: "refs/heads/main",
          ahead: 3,
          behind: 0,
        },
        operation: null,
      },
    ],
  };
  return {
    projects: [web, api],
    diffs: {
      [diffKey(WEB, "unstaged", "src/session.ts")]: sessionDiff(),
      [diffKey(WEB_DARK, "unstaged", "src/theme.css")]: commitFileDiff(
        "src/theme.css",
        "Darker surfaces",
      ),
      [diffKey(WEB_LOGIN, "staged", "README.md")]: commitFileDiff(
        "README.md",
        "Login notes",
      ),
      [diffKey(API, "unstaged", "src/limits.ts")]: commitFileDiff(
        "src/limits.ts",
        "Lower the limit",
      ),
      [diffKey(WEB, "untracked", "notes.txt")]: NEW_FILE("notes.txt", [
        "Ask about the cookie lifetime.",
        "Check the redirect on mobile.",
      ]),
      [diffKey(WEB, "staged", "src/retry.ts")]: NEW_FILE("src/retry.ts", [
        "export async function retry<T>(task: () => Promise<T>, times = 3): Promise<T> {",
        "  for (let attempt = 1; ; attempt += 1) {",
        "    try {",
        "      return await task();",
        "    } catch (error) {",
        "      if (attempt >= times) throw error;",
        "    }",
        "  }",
        "}",
      ]),
    },
    conflicts: { [`${WEB_LOGIN}|src/session.ts`]: sessionConflict },
    preferences: {
      version: 1,
      projects: [WEB, API],
      filters: {},
      ui: {
        diffLayout: "unified",
        ignoreWhitespace: false,
        sidebarWidth: 272,
        historySplit: 0.55,
        changesSplit: 0.42,
        lastWorktree: WEB,
      },
    },
  };
}

/** A small diff for any file of any commit. */
export function commitFileDiff(path: string, subject: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1f2e3d4..5c6b7a8 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,4 +1,4 @@",
    ` // ${path}`,
    '-export const cookieName = "sid";',
    '+export const cookieName = "ratel_session";',
    ` export const note = ${JSON.stringify(subject)};`,
    " export default cookieName;",
    "",
  ].join("\n");
}

export function findTree(
  world: FakeWorld,
  path: string,
): [FakeProject, FakeTree] {
  for (const project of world.projects) {
    const tree = project.trees.find((t) => t.path === path);
    if (tree) return [project, tree];
  }
  throw new BridgeError(
    "not_found",
    "This folder is not a worktree of a project in the sidebar.",
  );
}

/** A first launch: no projects yet. */
export function emptyWorld(): FakeWorld {
  const world = createWorld();
  return {
    ...world,
    projects: [],
    preferences: {
      ...world.preferences,
      projects: [],
      ui: { ...world.preferences.ui, lastWorktree: null },
    },
  };
}
