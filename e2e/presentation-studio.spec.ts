import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tools/presentation-editor");
  await expect(page.getByRole("heading", { level: 1, name: "Presentation Editor" })).toBeVisible();
  await expect(page.getByLabel("Slide title")).toBeVisible();
});

test("edits a slide title and body", async ({ page }) => {
  await page.getByLabel("Slide title").fill("Quarterly Plan");
  await page.locator('#deck-layout').selectOption('title-body');
  await page.getByLabel("Slide body").fill("Revenue grew 20% this quarter.");
  await expect(page.locator(".deck__thumb-title").first()).toHaveText("Quarterly Plan");
  await expect(page.getByLabel("Slide body")).toHaveValue("Revenue grew 20% this quarter.");
});

test("adds, duplicates and deletes slides", async ({ page }) => {
  const slides = page.locator(".deck__list li");
  await expect(slides).toHaveCount(1);

  await page.getByRole("button", { name: "Add slide" }).click();
  await expect(slides).toHaveCount(2);

  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(slides).toHaveCount(3);

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(slides).toHaveCount(2);
});

test("switches theme and presents the deck", async ({ page }) => {
  await page.getByLabel("Slide title").fill("Quarterly Plan");
  await page.locator("#deck-theme").selectOption("slate");

  await page.getByRole("button", { name: "Present", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Presenting" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Quarterly Plan" })).toBeVisible();

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

test("exports the deck as a PDF download", async ({ page }) => {
  await page.getByLabel("Slide title").fill("Quarterly Plan");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
});
