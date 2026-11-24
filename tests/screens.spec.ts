import { expect, test, type Page } from "@playwright/test";
import process from "node:process";

// Screenshots for visual review. Runs only when SHOTS_DIR is set:
//   SHOTS_DIR=/path/to/folder pnpm test:e2e tests/screens.spec.ts
const directory = process.env.SHOTS_DIR;

test.skip(!directory, "set SHOTS_DIR to write screenshots");

async function open(
  page: Page,
  scheme: "light" | "dark",
  size = { width: 1460, height: 850 },
) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.getByTestId("commit-row").first()).toBeVisible();
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${directory}/${name}.png` });

test("history", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await open(page, scheme);
    await page
      .getByTestId("commit-row")
      .filter({ hasText: "Rename the session cookie" })
      .click();
    await expect(page.getByTestId("diff-body")).toBeVisible();
    await shot(page, `a-history-${scheme}`);
  }
});

test("filtered", async ({ page }) => {
  await open(page, "light");
  await page.locator('[data-ref="refs/heads/feature/auth/oauth"]').hover();
  await page
    .locator('[data-ref="refs/heads/feature/auth/oauth"] .filter-toggle')
    .click();
  await page.locator('[data-ref="refs/heads/fix/login-redirect"]').hover();
  await page
    .locator('[data-ref="refs/heads/fix/login-redirect"] .filter-toggle')
    .click();
  await expect(page.getByTestId("filter-bar")).toBeVisible();
  await page.mouse.move(800, 400);
  await shot(page, "b-filtered");
});

test("changes", async ({ page }) => {
  await open(page, "light");
  await page.getByRole("button", { name: /^Changes/ }).click();
  await page
    .getByTestId("change-row")
    .filter({ hasText: "session.ts" })
    .click();
  await expect(page.getByTestId("hunk-stage").first()).toBeVisible();
  await shot(page, "d-changes-file");
  await page
    .getByTestId("worktree-row")
    .filter({ hasText: "api-server" })
    .click();
  await page.getByRole("button", { name: /^Changes/ }).click();
  await shot(page, "c-changes-unselected");
});

test("conflict", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await open(page, scheme);
    await page
      .getByTestId("worktree-row")
      .filter({ hasText: "ratel-web-login" })
      .click();
    await page.getByRole("button", { name: /^Changes/ }).click();
    await page
      .getByTestId("change-row")
      .filter({ hasText: "session.ts" })
      .click();
    await expect(page.getByTestId("conflict-view")).toBeVisible();
    await page
      .getByRole("button", { name: /^Accept main/ })
      .first()
      .click();
    await shot(page, `f-conflict-${scheme}`);
  }
});

test("minimum window", async ({ page }) => {
  await open(page, "light", { width: 1050, height: 630 });
  await page
    .getByTestId("commit-row")
    .filter({ hasText: "Merge branch" })
    .click();
  await shot(page, "e-minimum");
  await page.getByRole("button", { name: /^Changes/ }).click();
  await page
    .getByTestId("change-row")
    .filter({ hasText: "session.ts" })
    .click();
  await shot(page, "e-minimum-changes");
});

test("quick switcher", async ({ page }) => {
  await open(page, "dark");
  await page.keyboard.press("ControlOrMeta+KeyP");
  await page.keyboard.type("log");
  await shot(page, "g-switcher");
});

test("first launch and split diff", async ({ page }) => {
  await page.goto("/?fake=empty");
  await expect(page.getByText("Open a Git repository")).toBeVisible();
  await shot(page, "i-first-launch");
  await open(page, "dark");
  await page.getByRole("button", { name: /^Changes/ }).click();
  await page
    .getByTestId("change-row")
    .filter({ hasText: "session.ts" })
    .click();
  await page.getByRole("button", { name: "Split" }).click();
  await shot(page, "j-split-dark");
  await page.getByRole("button", { name: "Unified" }).click();
});

test.describe("detail", () => {
  test.use({ deviceScaleFactor: 2 });
  test("readme screenshots", async ({ page }) => {
    await open(page, "light");
    await page
      .getByTestId("commit-row")
      .filter({ hasText: "Rename the session cookie" })
      .click();
    await expect(page.getByTestId("diff-body")).toContainText("ratel_session");
    await shot(page, "docs-history");
    await page.getByRole("button", { name: /^Changes/ }).click();
    await page
      .getByTestId("change-row")
      .filter({ hasText: "session.ts" })
      .click();
    await page.locator(".diff-select.box").nth(3).click();
    await shot(page, "docs-changes");
    await page
      .getByTestId("worktree-row")
      .filter({ hasText: "ratel-web-login" })
      .click();
    await page.getByRole("button", { name: /^Changes/ }).click();
    await page
      .getByTestId("change-row")
      .filter({ hasText: "session.ts" })
      .click();
    await page
      .getByTestId("chunk-card")
      .first()
      .getByRole("button", { name: "Accept main" })
      .click();
    await page.mouse.move(700, 700);
    await shot(page, "docs-conflicts");
  });

  test("graph close-up", async ({ page }) => {
    await open(page, "light");
    await page.screenshot({
      path: `${directory}/h-graph-zoom.png`,
      clip: { x: 272, y: 90, width: 520, height: 390 },
    });
  });
});

test("new worktree dialog", async ({ page }) => {
  await open(page, "light");
  await page
    .locator('[data-ref="refs/heads/feature/auth/oauth"]')
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Check Out in New Worktree…" })
    .click();
  await page.getByRole("button", { name: "Choose Folder…" }).click();
  await expect(page.getByText("/work/trees")).toBeVisible();
  await shot(page, "k-new-worktree");
});
