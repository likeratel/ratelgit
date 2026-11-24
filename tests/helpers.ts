import { expect, type Page } from "@playwright/test";

export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("commit-row").first()).toBeVisible();
}

/** Actions the UI sent to the fake core, in order. */
export function sentActions(
  page: Page,
): Promise<{ type: string; [key: string]: unknown }[]> {
  return page.evaluate(() => (window.__ratelgitFake?.actions() ?? []) as never);
}

export async function lastAction(page: Page) {
  return (await sentActions(page)).at(-1);
}

export const worktree = (page: Page, name: string) =>
  page.getByTestId("worktree-row").filter({
    has: page.locator(".worktree-name", { hasText: new RegExp(`^${name}$`) }),
  });

export const headerName = (page: Page) => page.locator(".header-name");

export async function toggleRefFilter(page: Page, ref: string): Promise<void> {
  const row = page.locator(`[data-ref="${ref}"]`);
  await row.hover();
  await row.locator(".filter-toggle").click();
}
