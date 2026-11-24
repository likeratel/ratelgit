import { describe, expect, it } from "vitest";
import { buildBranchTree, isFolder, refsBelow } from "./branchTree";

const local = (name: string) => ({
  id: `refs/heads/${name}`,
  name,
  kind: "local",
});
const remote = (name: string) => ({
  id: `refs/remotes/${name}`,
  name,
  kind: "remote",
});

describe("buildBranchTree", () => {
  it("puts folders first and sorts names without case", () => {
    const tree = buildBranchTree(
      ["main", "feature/x/y", "feature/x/z", "feature/a", "Zeta", "alpha"].map(
        local,
      ),
    );
    expect(tree.map((n) => n.name)).toEqual([
      "feature",
      "alpha",
      "main",
      "Zeta",
    ]);
    const feature = tree[0];
    expect(isFolder(feature)).toBe(true);
    expect(feature.reference).toBeNull();
    expect(feature.children.map((n) => n.name)).toEqual(["x", "a"]);
    expect(feature.children[0].children.map((n) => n.path)).toEqual([
      "feature/x/y",
      "feature/x/z",
    ]);
    expect(
      refsBelow(feature)
        .map((r) => r.id)
        .sort(),
    ).toEqual([
      "refs/heads/feature/a",
      "refs/heads/feature/x/y",
      "refs/heads/feature/x/z",
    ]);
    expect(isFolder(tree[2])).toBe(false);
  });

  it("groups remotes under their remote name with distinct folder ids", () => {
    const tree = buildBranchTree(
      ["origin/main", "origin/feature/x", "upstream/main"].map(remote),
    );
    expect(tree.map((n) => n.name)).toEqual(["origin", "upstream"]);
    expect(tree[0].children.map((n) => n.name)).toEqual(["feature", "main"]);
    expect(tree[0].id).not.toBe(buildBranchTree([local("origin/x")])[0].id);
  });

  it("keeps a branch that is also a folder name", () => {
    const tree = buildBranchTree(["fix", "fix/a"].map(local));
    expect(tree[0].reference?.id).toBe("refs/heads/fix");
    expect(tree[0].children[0].reference?.id).toBe("refs/heads/fix/a");
  });
});
