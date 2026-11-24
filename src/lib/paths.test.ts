import { describe, expect, it } from "vitest";
import { baseName, fileName, folderOf, suggestWorktreeName } from "./paths";

describe("paths", () => {
  it("splits repository and system paths", () => {
    expect(baseName("/work/app/")).toBe("app");
    expect(baseName("C:\\work\\app")).toBe("app");
    expect(baseName("C:/work/app")).toBe("app");
    expect(folderOf("src/lib/a.ts")).toBe("src/lib");
    expect(folderOf("a.ts")).toBe("");
    expect(fileName("src/lib/a.ts")).toBe("a.ts");
    expect(fileName("nested/")).toBe("nested/");
  });

  it("suggests a folder name for a new worktree", () => {
    expect(suggestWorktreeName("/work/app", "feature/x")).toBe("app-feature-x");
    expect(suggestWorktreeName("C:\\work\\app", "fix")).toBe("app-fix");
  });
});
