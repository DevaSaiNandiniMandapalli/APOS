import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tools/spreadsheet-editor");
  await expect(page.getByRole("heading", { level: 1, name: "Spreadsheet Editor" })).toBeVisible();
  await expect(page.locator('[aria-label="Cell A1"]')).toBeVisible();
});

test("evaluates arithmetic and range formulas live", async ({ page }) => {
  await page.locator('[aria-label="Cell A1"]').fill("10");
  await page.locator('[aria-label="Cell A2"]').fill("20");
  await page.locator('[aria-label="Cell A3"]').fill("30");

  await page.locator('[aria-label="Cell B1"]').fill("=A1+A2");
  await page.locator('[aria-label="Cell B1"]').click();
  await expect(page.locator(".spreadsheet__result")).toHaveText("= 30");

  await page.locator('[aria-label="Cell B2"]').fill("=SUM(A1:A3)");
  await page.locator('[aria-label="Cell B2"]').click();
  await expect(page.locator(".spreadsheet__result")).toHaveText("= 60");

  await page.locator('[aria-label="Cell B3"]').fill("=AVERAGE(A1:A3)");
  await page.locator('[aria-label="Cell B3"]').click();
  await expect(page.locator(".spreadsheet__result")).toHaveText("= 20");
});

test("exports a CSV download and imports CSV data", async ({ page }) => {
  await page.locator('[aria-label="Cell A1"]').fill("name");
  await page.locator('[aria-label="Cell B1"]').fill("score");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("spreadsheet.csv");

  await page.locator('[aria-label="Import CSV file"]').setInputFiles({
    name: "data.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("5,6\n7,8"),
  });
  await expect(page.locator('[aria-label="Cell A1"]')).toHaveValue("5");
  await expect(page.locator('[aria-label="Cell B2"]')).toHaveValue("8");
});

test("adds rows and columns", async ({ page }) => {
  const rowCount = async () => page.locator(".spreadsheet__grid tbody tr").count();
  const colCount = async () => page.locator(".spreadsheet__grid thead th").count();

  const rowsBefore = await rowCount();
  await page.getByRole("button", { name: "Add row" }).click();
  await expect.poll(rowCount).toBe(rowsBefore + 1);

  const colsBefore = await colCount();
  await page.getByRole("button", { name: "Add column" }).click();
  await expect.poll(colCount).toBe(colsBefore + 1);
});
