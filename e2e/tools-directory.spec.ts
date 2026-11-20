import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("All tools searches and filters the full registry", async ({ page }) => {
  await page.goto("/tools");
  await expect(page.getByRole("heading", { level: 1, name: "All 43 tools" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Merge PDF" })).toBeVisible();

  const search = page.getByLabel("Search all tools");
  await search.fill("passport");
  await expect(page.getByRole("heading", { level: 2, name: "Document Passport" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Merge PDF" })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("1 of 43 tools");

  await page.getByRole("button", { name: "Clear tool search" }).click();
  await page.locator(".directory-select select").nth(0).selectOption("pdf-conversion");
  await expect(page.getByRole("heading", { level: 2, name: "PDF to Markdown" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Merge PDF" })).toHaveCount(0);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.locator(".directory-select select").nth(1).selectOption("ai");
  await expect(page.getByRole("heading", { level: 2, name: "AI assistant" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Merge PDF" })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("3 of 43 tools");
});

test("All tools is reachable from the workspace and has no axe violations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "All tools", exact: true }).first().click();
  await expect(page).toHaveURL(/\/tools$/);
  await expect(page.getByRole("heading", { level: 1, name: "All 43 tools" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("All tools fits a mobile viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools");
  await expect(page.getByRole("heading", { level: 1, name: "All 43 tools" })).toBeVisible();
  const metrics = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.inner + 1);
  await expect(page.getByRole("searchbox", { name: "Search all tools" })).toBeVisible();
});
