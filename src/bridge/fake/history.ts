/** Commit graphs of the fake projects. */

import type { CommitLine } from "../types";
import { fakeHash } from "./ids";

export interface FakeCommit {
  hash: string;
  subject: string;
  body: string;
  author: string;
  email: string;
  /** ISO 8601. */
  date: string;
  parents: string[];
  files: { path: string; status: string }[];
}

interface Spec {
  key: string;
  subject: string;
  parents: string[];
  author?: number;
  files?: string[];
}

const AUTHORS = [
  ["Mina Park", "mina@example.invalid"],
  ["Leo Hart", "leo@example.invalid"],
  ["Sam Rivera", "sam@example.invalid"],
  ["Ana Costa", "ana@example.invalid"],
] as const;

const OLDER_SUBJECTS = [
  "Add a health check endpoint",
  "Configure the linter",
  "Write the first route tests",
  "Extract the layout component",
  "Add favicon and manifest",
  "Set up continuous integration",
  "Load settings from the environment",
  "Add a 404 page",
  "Format with the shared config",
  "Pin the toolchain version",
  "Document the folder layout",
  "Add a loading indicator",
  "Handle network errors in fetch",
  "Cache static assets",
  "Split the router module",
  "Add keyboard focus styles",
  "Bump dependencies",
  "Remove the unused helpers",
  "Add the logout button",
  "Rename the user store",
  "Fix flaky clock test",
  "Add the sign-in page",
  "Create the API client",
  "Initial commit",
];

const DAY = 86_400_000;

function build(specs: Spec[], start: number): FakeCommit[] {
  const hashes = new Map(specs.map((s) => [s.key, fakeHash(s.key)]));
  return specs.map((spec, index) => {
    const [author, email] = AUTHORS[spec.author ?? index % AUTHORS.length];
    return {
      hash: hashes.get(spec.key) ?? fakeHash(spec.key),
      subject: spec.subject,
      body: "",
      author,
      email,
      date: new Date(start - index * (DAY / 3))
        .toISOString()
        .replace(".000Z", "+00:00"),
      parents: spec.parents.map((p) => hashes.get(p) ?? fakeHash(p)),
      files: (spec.files ?? ["src/app.ts"]).map((path) => ({
        path,
        status: "M",
      })),
    };
  });
}

/** A linear run of older commits; the first one is keyed `from`. */
function older(prefix: string, from: string, count: number): Spec[] {
  const key = (i: number) => (i === 0 ? from : `${prefix}-old-${i}`);
  return Array.from({ length: count }, (_, i) => ({
    key: key(i),
    subject: OLDER_SUBJECTS[i % OLDER_SUBJECTS.length],
    parents: i + 1 < count ? [key(i + 1)] : [],
    files: [`src/${["app", "routes", "client", "store"][i % 4]}.ts`],
  }));
}

export const WEB_START = Date.parse("2026-02-27T16:20:00Z");

export const webCommits: FakeCommit[] = build(
  [
    {
      key: "web-docs",
      subject: "Document local setup",
      parents: ["web-merge"],
      author: 0,
      files: ["README.md"],
    },
    {
      key: "web-dark",
      subject: "Add a dark colour scheme",
      parents: ["web-merge"],
      author: 1,
      files: ["src/theme.css", "src/theme.ts"],
    },
    {
      key: "web-merge",
      subject: "Merge branch 'feature/auth/oauth'",
      parents: ["web-font", "web-scope"],
      author: 0,
      files: ["src/auth/oauth.ts"],
    },
    {
      key: "web-scope",
      subject: "Request the read:user scope",
      parents: ["web-provider"],
      author: 2,
      files: ["src/auth/oauth.ts"],
    },
    {
      key: "web-provider",
      subject: "Sketch the OAuth provider",
      parents: ["web-cookie"],
      author: 2,
      files: ["src/auth/oauth.ts", "src/auth/index.ts"],
    },
    {
      key: "web-font",
      subject: "Use the system font",
      parents: ["web-cookie"],
      author: 1,
      files: ["src/styles.css"],
    },
    {
      key: "web-redirect",
      subject: "Redirect to home after login",
      parents: ["web-cookie"],
      author: 3,
      files: ["src/session.ts"],
    },
    {
      key: "web-cookie",
      subject: "Rename the session cookie",
      parents: ["web-store"],
      author: 0,
      files: ["src/cookie.ts"],
    },
    {
      key: "web-store",
      subject: "Store sessions in a cookie",
      parents: ["web-styles"],
      author: 0,
      files: ["src/session.ts", "src/cookie.ts"],
    },
    {
      key: "web-styles",
      subject: "Add base styles",
      parents: ["web-old-0"],
      author: 1,
      files: ["src/styles.css"],
    },
    ...older("web", "web-old-0", 24),
  ],
  WEB_START,
);

export const apiCommits: FakeCommit[] = build(
  [
    {
      key: "api-limit",
      subject: "Rate-limit the login endpoint",
      parents: ["api-pool"],
      author: 2,
    },
    {
      key: "api-pool",
      subject: "Reuse database connections",
      parents: ["api-log"],
      author: 3,
    },
    {
      key: "api-log",
      subject: "Log request IDs",
      parents: ["api-old-0"],
      author: 2,
    },
    ...older("api", "api-old-0", 14),
  ],
  Date.parse("2026-02-26T11:05:00Z"),
);

export function webHash(key: string): string {
  return fakeHash(key);
}

export function toLine(
  commit: FakeCommit,
  index: number,
  refs: string[],
): CommitLine {
  return {
    index,
    hash: commit.hash,
    shortHash: commit.hash.slice(0, 7),
    subject: commit.subject,
    author: commit.author,
    date: commit.date.slice(0, 10),
    timestamp: Math.floor(Date.parse(commit.date) / 1000),
    refs,
    parents: commit.parents,
  };
}

/** Commits reachable from `heads`, keeping the listing order. */
export function reachable(
  commits: FakeCommit[],
  heads: string[],
): FakeCommit[] {
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const seen = new Set<string>();
  const stack = [...heads];
  while (stack.length) {
    const hash = stack.pop() as string;
    if (seen.has(hash) || !byHash.has(hash)) continue;
    seen.add(hash);
    stack.push(...(byHash.get(hash)?.parents ?? []));
  }
  return commits.filter((c) => seen.has(c.hash));
}
