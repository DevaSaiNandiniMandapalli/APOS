import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";

async function makePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([420, 560]);
  page.drawText("Document Passport fixture", { x: 30, y: 500, size: 14, font });
  pdf.setTitle("Sensitive project");
  pdf.setAuthor("A. Person");
  pdf.setSubject("Internal notes");
  return Buffer.from(await pdf.save());
}

test("Document Passport scans a PDF locally and creates a clean copy", async ({ page }) => {
  await page.goto("/tools/document-passport");
  await expect(page.getByRole("heading", { level: 1, name: "Document Passport" })).toBeVisible();
  await page.getByLabel("Choose a document").setInputFiles({
    name: "passport.pdf",
    mimeType: "application/pdf",
    buffer: await makePdf(),
  });

  await expect(page.getByText("Flags to review")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Document metadata").first()).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Create clean PDF copy" }).click();
  await page.getByRole("link", { name: "Download clean PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("passport-clean.pdf");
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = await import("node:fs/promises").then(({ readFile }) => readFile(path!));
  const cleaned = await PDFDocument.load(bytes);
  expect(cleaned.getPageCount()).toBe(1);
  expect(cleaned.getTitle() ?? "").toBe("");
  expect(cleaned.getAuthor() ?? "").toBe("");
});

test("Document Passport fits a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/document-passport");
  const metrics = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.inner + 1);
});
