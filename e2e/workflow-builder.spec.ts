import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tools/workflow-builder");
  await expect(page.getByRole("heading", { level: 1, name: "Workflow builder" })).toBeVisible();
});

test("adds, reorders and removes steps", async ({ page }) => {
  await expect(page.getByRole("status")).toContainText("Add at least one step");

  await page.locator("#workflow-step").selectOption("merge");
  await page.getByRole("button", { name: "Add step" }).click();
  await page.locator("#workflow-step").selectOption("compress");
  await page.getByRole("button", { name: "Add step" }).click();

  const labels = page.locator(".workflow__label");
  await expect(labels).toHaveText(["Merge PDFs", "Compress"]);
  await expect(page.getByRole("status")).toContainText("Ready — 2 steps");

  await page.getByRole("button", { name: "Move Compress up" }).click();
  await expect(labels).toHaveText(["Compress", "Merge PDFs"]);

  await page.getByRole("button", { name: "Remove Compress" }).click();
  await expect(labels).toHaveText(["Merge PDFs"]);
});

test("exports the workflow as JSON", async ({ page }) => {
  await page.getByLabel("Name").fill("Daily cleanup");
  await page.locator("#workflow-step").selectOption("compress");
  await page.getByRole("button", { name: "Add step" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("workflow.apos.json");
});
