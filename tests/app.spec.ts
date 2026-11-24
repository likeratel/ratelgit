import { expect, test } from "@playwright/test";
import {
  headerName,
  lastAction,
  openApp,
  sentActions,
  toggleRefFilter,
  worktree,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("moves between projects and worktrees", async ({ page }) => {
  await expect(headerName(page)).toHaveText("ratel-web");
  await worktree(page, "ratel-web-dark").click();
  await expect(headerName(page)).toHaveText("ratel-web-dark");
  await expect(page.locator(".header-branch")).toContainText(
    "feature/ui/dark-mode",
  );
  await worktree(page, "api-server").click();
  await expect(headerName(page)).toHaveText("api-server");
  await expect(page.getByTestId("commit-row").first()).toContainText(
    "Rate-limit the login endpoint",
  );
  await expect(
    page.locator(".sidebar-section.refs .sidebar-header"),
  ).toContainText("api-server");
});

test("starts on the default filter, shows all, and goes back", async ({
  page,
}) => {
  const bar = page.getByTestId("filter-bar");
  const showAll = bar.getByRole("button", { name: /^Show All/ });
  const reset = bar.getByRole("button", { name: /^Default/ });
  await expect(bar.locator(".filter-chip")).toHaveText([
    "Current branch · main",
    "origin/main",
  ]);
  await expect(reset).toBeDisabled();
  await expect(showAll).toBeEnabled();
  await expect(
    page
      .getByTestId("commit-row")
      .filter({ hasText: "Add a dark colour scheme" }),
  ).toHaveCount(0);

  await showAll.click();
  await expect(bar).toContainText("All branches");
  await expect(bar.locator(".filter-chip")).toHaveCount(0);
  await expect(showAll).toBeDisabled();
  await expect(reset).toBeEnabled();
  await expect(
    page
      .getByTestId("commit-row")
      .filter({ hasText: "Add a dark colour scheme" }),
  ).toHaveCount(1);

  await reset.click();
  await expect(bar.locator(".filter-chip")).toHaveCount(2);
  await expect(reset).toBeDisabled();
});

test("filters history by branches and shows everything again", async ({
  page,
}) => {
  const bar = page.getByTestId("filter-bar");
  await bar.getByRole("button", { name: /^Show All/ }).click();
  await toggleRefFilter(page, "refs/heads/feature/auth/oauth");
  await toggleRefFilter(page, "refs/heads/fix/login-redirect");
  await expect(bar.locator(".filter-chip")).toHaveCount(2);
  await expect(bar).toContainText("HEAD not shown");
  await expect(page.getByTestId("commit-row").first()).toContainText(
    "Request the read:user scope",
  );
  await expect(
    page.getByTestId("commit-row").filter({ hasText: "Document local setup" }),
  ).toHaveCount(0);

  await bar
    .getByRole("button", { name: "Remove feature/auth/oauth from filter" })
    .click();
  await expect(bar.locator(".filter-chip")).toHaveCount(1);
  await bar.getByRole("button", { name: /^Show All/ }).click();
  await expect(bar).toContainText("All branches");
  await expect(page.getByTestId("commit-row").first()).toContainText(
    "Document local setup",
  );

  await page.keyboard.press("ControlOrMeta+Shift+KeyA");
  await expect(bar.locator(".filter-chip")).toHaveText([
    "Current branch · main",
  ]);
  await page.keyboard.press("ControlOrMeta+Shift+KeyA");
  await expect(bar).toContainText("All branches");
});

test("adding a branch to the default filter keeps the current branch", async ({
  page,
}) => {
  await toggleRefFilter(page, "refs/heads/fix/login-redirect");
  const bar = page.getByTestId("filter-bar");
  await expect(bar.locator(".filter-chip")).toHaveText([
    "Current branch · main",
    "origin/main",
    "fix/login-redirect",
  ]);
  await expect(bar.getByRole("button", { name: /^Default/ })).toBeEnabled();
});

test("filter of a folder covers every branch in it", async ({ page }) => {
  await page
    .getByTestId("filter-bar")
    .getByRole("button", { name: /^Show All/ })
    .click();
  const folder = page.locator(".folder-row", { hasText: "auth" });
  await folder.hover();
  await folder.locator(".filter-toggle").click();
  await expect(
    page.getByTestId("filter-bar").locator(".filter-chip"),
  ).toHaveText(["feature/auth/oauth"]);
});

test("switches between History and Changes with shortcuts", async ({
  page,
}) => {
  await page.keyboard.press("ControlOrMeta+Digit2");
  await expect(page.locator(".pane-title")).toHaveText("Working Changes");
  await expect(page.getByTestId("change-row")).toHaveCount(3);
  await page.keyboard.press("ControlOrMeta+Digit1");
  await expect(page.getByTestId("commit-list")).toBeVisible();
  await page
    .getByTestId("commit-row")
    .filter({ hasText: "Uncommitted" })
    .count();
  await page.locator(".commit-row.uncommitted").click();
  await expect(page.locator(".pane-title")).toHaveText("Working Changes");
});

test("selects a commit and shows its details below the list", async ({
  page,
}) => {
  await page
    .getByTestId("commit-row")
    .filter({ hasText: "Merge branch 'feature/auth/oauth'" })
    .click();
  const detail = page.getByTestId("commit-detail");
  await expect(detail.locator(".commit-subject")).toHaveText(
    "Merge branch 'feature/auth/oauth'",
  );
  await expect(detail).toContainText("Parents");
  await expect(detail.getByTestId("diff-body")).toContainText("ratel_session");
  await page.getByTestId("commit-list").press("ArrowDown");
  await expect(detail.locator(".commit-subject")).toHaveText(
    "Request the read:user scope",
  );
});

test("stages a hunk and a file from Changes", async ({ page }) => {
  await page.getByRole("button", { name: /^Changes/ }).click();
  await page
    .getByTestId("change-row")
    .filter({ hasText: "session.ts" })
    .click();
  await page.getByTestId("hunk-stage").first().click();
  const action = await lastAction(page);
  expect(action).toMatchObject({
    type: "applyLines",
    operation: "stage",
    lines: [7, 8],
  });
  expect(String(action?.source)).toContain("@@ -1,6 +1,6 @@");

  await page.getByTestId("change-row").filter({ hasText: "notes.txt" }).click();
  await page.getByTestId("change-list").press("Space");
  await expect.poll(async () => (await lastAction(page))?.type).toBe("stage");
  await expect(page.locator(".change-group.staged")).toContainText("notes.txt");
});

test("asks before discarding", async ({ page }) => {
  await page.getByRole("button", { name: /^Changes/ }).click();
  const row = page.getByTestId("change-row").filter({ hasText: "session.ts" });
  await row.hover();
  await row.getByRole("button", { name: "Discard changes" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Discard Changes?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(await sentActions(page)).toEqual([]);
});

test("quick switcher jumps to a worktree", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+KeyP");
  const dialog = page.getByRole("dialog", { name: "Quick switcher" });
  await expect(dialog).toBeVisible();
  await page.keyboard.type("web-dark");
  await expect(dialog.locator(".switcher-item").first()).toContainText(
    "ratel-web-dark",
  );
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(headerName(page)).toHaveText("ratel-web-dark");
});

test("resolves a merge conflict chunk by chunk and commits the merge", async ({
  page,
}) => {
  await worktree(page, "ratel-web-login").click();
  const banner = page.getByTestId("operation-banner");
  await expect(banner).toContainText("Merging main into fix/login-redirect");
  await expect(
    banner.getByRole("button", { name: "Commit Merge…" }),
  ).toBeDisabled();
  await banner.getByRole("button", { name: "Show Conflicts" }).click();
  await page
    .getByTestId("change-row")
    .filter({ hasText: "session.ts" })
    .click();

  const view = page.getByTestId("conflict-view");
  const save = view.getByTestId("save-resolution");
  await expect(view.getByTestId("unresolved-count")).toHaveText(
    "2 of 2 conflicts to choose",
  );
  await expect(save).toBeDisabled();
  const cards = view.getByTestId("chunk-card");
  await cards.nth(0).getByRole("button", { name: "Accept main" }).click();
  await expect(cards.nth(1)).toHaveClass(/active/);
  await cards
    .nth(1)
    .getByRole("button", { name: /^Both, fix\/login-redirect first/ })
    .click();
  await expect(view.getByTestId("unresolved-count")).toHaveText(
    "All 2 conflicts chosen",
  );
  await view.getByRole("button", { name: "Result preview" }).click();
  await expect(view.getByTestId("result-preview")).toContainText(
    'return user.returnTo ?? "/dashboard";',
  );
  await save.click();
  expect(await lastAction(page)).toMatchObject({
    type: "saveResolution",
    choices: ["theirs", "oursThenTheirs"],
  });
  await expect(banner).toContainText("1 conflicted file left");

  await page.getByTestId("change-row").filter({ hasText: "legacy.md" }).click();
  await view.getByRole("button", { name: "Keep File" }).click();
  await expect(banner).toContainText("All conflicts are resolved");
  await banner.getByRole("button", { name: "Commit Merge…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox")).toHaveValue(
    "Merge branch 'main' into fix/login-redirect",
  );
  await dialog.getByRole("button", { name: "Commit Merge" }).click();
  await expect(banner).toHaveCount(0);
  expect(await lastAction(page)).toMatchObject({
    type: "continue",
    operation: "merge",
  });
});

test("abort needs confirmation", async ({ page }) => {
  await worktree(page, "ratel-web-login").click();
  await page
    .getByTestId("operation-banner")
    .getByRole("button", { name: "Abort Merge…" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Abort Merge?");
  await dialog.getByRole("button", { name: "Abort Merge" }).click();
  await expect(page.getByTestId("operation-banner")).toHaveCount(0);
  expect(await lastAction(page)).toEqual({ type: "abort", operation: "merge" });
});

test("stages two hunks in a row and keeps the diff current", async ({
  page,
}) => {
  await page.getByRole("button", { name: /^Changes/ }).click();
  await page
    .getByTestId("change-row")
    .filter({ hasText: "session.ts" })
    .first()
    .click();
  await expect(page.getByTestId("hunk-stage")).toHaveCount(2);
  await page.getByTestId("hunk-stage").first().click();
  await expect(page.getByTestId("hunk-stage")).toHaveCount(1);
  await page.getByTestId("hunk-stage").first().click();
  await expect(page.locator(".error-bar")).toHaveCount(0);
  const staged = await sentActions(page);
  expect(staged.filter((a) => a.type === "applyLines")).toHaveLength(2);
  await expect(page.locator(".change-group.staged")).toContainText(
    "session.ts",
  );
  await expect(page.locator(".change-group.unstaged")).toHaveCount(0);
  await expect(page.getByTestId("diff-body")).toContainText("compute(3)");
});

test("Space stages and unstages the same file", async ({ page }) => {
  await page.getByRole("button", { name: /^Changes/ }).click();
  await page
    .getByTestId("change-row")
    .filter({ hasText: "session.ts" })
    .first()
    .click();
  const list = page.getByTestId("change-list");
  await list.press("Space");
  await expect(
    page.locator(".change-group.staged .change-row.selected"),
  ).toContainText("session.ts");
  await list.press("Space");
  await expect(
    page.locator(".change-group.unstaged .change-row.selected"),
  ).toContainText("session.ts");
  await expect(page.locator(".error-bar")).toHaveCount(0);
  expect((await sentActions(page)).map((a) => a.type)).toEqual([
    "stage",
    "unstage",
  ]);
});

test("saving a resolution closes the conflict viewer", async ({ page }) => {
  await worktree(page, "ratel-web-login").click();
  await page.getByRole("button", { name: /^Changes/ }).click();
  await page
    .getByTestId("change-row")
    .filter({ hasText: "session.ts" })
    .click();
  const view = page.getByTestId("conflict-view");
  const cards = view.getByTestId("chunk-card");
  await cards.nth(0).getByRole("button", { name: "Accept main" }).click();
  await cards.nth(1).getByRole("button", { name: "Accept main" }).click();
  await view.getByTestId("save-resolution").click();
  await expect(view).toHaveCount(0);
  await expect(page.getByTestId("diff-view")).toContainText("resolved");
  await expect(
    page.locator(".change-group.staged .change-row.selected"),
  ).toContainText("session.ts");
});
