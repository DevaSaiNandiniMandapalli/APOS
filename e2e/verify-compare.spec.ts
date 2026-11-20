import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";

async function makePdf(pages: string[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pages.forEach((text) => pdf.addPage([360, 480]).drawText(text, { x: 30, y: 400, size: 14, font }));
  return Buffer.from(await pdf.save());
}

test("Verify & Compare detects an identical result", async ({ page }) => {
  const file = await makePdf(["Alpha page one", "Beta page two"]);
  await page.goto("/tools/verify-compare");
  await expect(page.getByRole("heading", { level: 1, name: "Verify & Compare" })).toBeVisible();
  await page.getByLabel("Original PDF").setInputFiles({ name: "before.pdf", mimeType: "application/pdf", buffer: file });
  await page.getByLabel("Result PDF").setInputFiles({ name: "after.pdf", mimeType: "application/pdf", buffer: file });
  await page.getByRole("button", { name: "Compare PDFs" }).click();
  await expect(page.getByRole("heading", { name: "Identical" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("2 → 2")).toBeVisible();
  await expect(page.getByText(/No page-count, size, text or visual differences/i)).toBeVisible();
});

test("Verify & Compare reports text, page size and missing-page differences", async ({ page }) => {
  const before = await makePdf(["Alpha page one", "Beta page two"]);
  const after = await makePdf(["Alpha page changed", "Beta page two", "Gamma page three"]);
  await page.goto("/tools/verify-compare");
  await page.getByLabel("Original PDF").setInputFiles({ name: "before.pdf", mimeType: "application/pdf", buffer: before });
  await page.getByLabel("Result PDF").setInputFiles({ name: "after.pdf", mimeType: "application/pdf", buffer: after });
  await page.getByRole("button", { name: "Compare PDFs" }).click();
  await expect(page.getByRole("heading", { name: /Major differences|Changed/ })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Page count changed from 2 to 3/)).toBeVisible();
  await expect(page.getByText("Text changed")).toBeVisible();
  await expect(page.getByText("Only in result")).toBeVisible();
  await page.getByRole("button", { name: "Preview" }).first().click();
  await expect(page.getByRole("heading", { name: "Page 1 side by side" })).toBeVisible();
  await expect(page.getByAltText("Original page 1")).toBeVisible();
  await expect(page.getByAltText("Result page 1")).toBeVisible();
});

test("Verify & Compare fits a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/verify-compare");
  const metrics = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.inner + 1);
});
