import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

async function makePdf(pages = 3) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= pages; index += 1) {
    const page = document.addPage([300, 400]);
    page.drawText(`Page ${index}`, { x: 30, y: 300, size: 18, font, color: rgb(0, 0, 0) });
  }
  document.setTitle("Repair me");
  document.setAuthor("APOS tests");
  return Buffer.from(await document.save());
}

function breakStartxref(buffer: Buffer) {
  const text = buffer.toString("latin1").replace(/startxref\s+\d+\s+%%EOF\s*$/, "startxref\n999999\n%%EOF\n");
  return Buffer.from(text, "latin1");
}

test("Repair PDF rebuilds structure and downloads a validated file", async ({ page }) => {
  await page.goto("/tools/repair-pdf");
  await expect(page.getByRole("heading", { name: "Repair PDF on this device" })).toBeVisible();
  await expect(page.getByText("Available", { exact: true })).toBeVisible();
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "broken.pdf", mimeType: "application/pdf", buffer: breakStartxref(await makePdf(3)) });
  await expect(page.locator(".pdf-file-line")).toContainText("broken.pdf");
  await page.getByRole("button", { name: "Repair PDF", exact: true }).click();
  await expect(page.getByText(/3 of 3 pages recovered/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/startxref offset/)).toBeVisible();
  await expect(page.getByText(/re-opened with the same page count/)).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download repaired PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("broken-repaired.pdf");
  const buffer = await readFile((await download.path())!);
  const repaired = await PDFDocument.load(buffer);
  expect(repaired.getPageCount()).toBe(3);
});

test("Repair PDF rejects a file that is not a PDF", async ({ page }) => {
  await page.goto("/tools/repair-pdf");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.locator(".merge-error")).toContainText("does not have a PDF signature");
  await expect(page.getByRole("button", { name: "Repair PDF", exact: true })).toBeDisabled();
});

test("Optimize PDF reports the measured size change and downloads a validated file", async ({ page }) => {
  await page.goto("/tools/optimize-pdf");
  await expect(page.getByRole("heading", { name: "Optimize PDF on this device" })).toBeVisible();
  await expect(page.getByText("Available", { exact: true })).toBeVisible();
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: await makePdf(2) });
  await page.getByRole("button", { name: "Optimize PDF", exact: true }).click();
  await expect(page.getByText(/Optimized and validated/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("2 (unchanged, sizes preserved)")).toBeVisible();
  await expect(page.getByText(/re-opened with the same page count/)).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download optimized PDF" }).click();
  const download = await downloadPromise;
  const buffer = await readFile((await download.path())!);
  const optimized = await PDFDocument.load(buffer);
  expect(optimized.getPageCount()).toBe(2);
  expect(optimized.getTitle()).toBe("Repair me");
});

test("Optimize PDF removes metadata only when the option is chosen", async ({ page }) => {
  await page.goto("/tools/optimize-pdf");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "meta.pdf", mimeType: "application/pdf", buffer: await makePdf(1) });
  await page.getByLabel(/Remove document information/).check();
  await page.getByRole("button", { name: "Optimize PDF", exact: true }).click();
  await expect(page.getByText(/Removed: Title/)).toBeVisible({ timeout: 20000 });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download optimized PDF" }).click();
  const download = await downloadPromise;
  const buffer = await readFile((await download.path())!);
  const optimized = await PDFDocument.load(buffer);
  expect(optimized.getTitle()).toBeFalsy();
});

test("Optimize PDF flattens form fields and counts them", async ({ page }) => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const target = document.addPage([420, 595]);
  const field = document.getForm().createTextField("customer.name");
  field.setText("Northwind");
  field.addToPage(target, { x: 40, y: 500, width: 200, height: 24, font });
  await page.goto("/tools/optimize-pdf");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "form.pdf", mimeType: "application/pdf", buffer: Buffer.from(await document.save()) });
  await page.getByLabel(/Flatten form fields/).check();
  await page.getByRole("button", { name: "Optimize PDF", exact: true }).click();
  await expect(page.getByText("Form fields flattened")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".pdf-report dd").nth(3)).toHaveText("1");
});
