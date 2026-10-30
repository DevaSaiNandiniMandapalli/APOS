import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("search is keyboard accessible and returns relevant planned tools", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const search = page.getByRole("textbox", { name: "Search tools" });
  await expect(search).toBeFocused();
  await search.fill("merge");
  await expect(page.getByRole("heading", { name: "Merge PDF" })).toBeVisible();
  await expect(page.getByText("Planned").first()).toBeVisible();
});

test("mobile navigation opens, remains labeled, and supports selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  const navigation = page.getByRole("navigation", { name: "Product studios" });
  await expect(navigation).toBeVisible();
  await navigation.getByRole("button", { name: "PDF Essentials" }).click();
  await expect(page.getByRole("heading", { name: "PDF Essentials" }).last()).toBeVisible();
});

test("theme preference persists across reloads", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("dashboard has no automated accessibility violations", async ({ page }) => {
  await page.goto("/");
  const lightResults = await new AxeBuilder({ page }).analyze();
  expect(lightResults.violations).toEqual([]);
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.waitForTimeout(200);
  const darkResults = await new AxeBuilder({ page }).analyze();
  expect(darkResults.violations).toEqual([]);
});
