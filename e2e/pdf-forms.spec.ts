import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";

async function makeForm() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 500]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const form = pdf.getForm();
  const name = form.createTextField("name");
  name.setText("Original");
  name.addToPage(page, { x: 40, y: 420, width: 220, height: 24, font });
  const agree = form.createCheckBox("agree");
  agree.addToPage(page, { x: 40, y: 380, width: 18, height: 18 });
  return Buffer.from(await pdf.save());
}

test("Fill PDF form fills and flattens standard fields", async ({ page }) => {
  const form = await makeForm();
  await page.goto("/tools/pdf-forms");
  await expect(page.getByRole("heading", { level: 1, name: "Fill PDF form" })).toBeVisible();
  await page.getByLabel("Choose a PDF with form fields").setInputFiles({ name: "form.pdf", mimeType: "application/pdf", buffer: form });
  await expect(page.getByText("2 field(s)")).toBeVisible({ timeout: 15000 });
  await page.getByLabel("name").fill("Ada Lovelace");
  await page.getByLabel("agree").check();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Fill and download PDF" }).click();
  await page.getByRole("link", { name: /Download form-filled\.pdf/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = await import("node:fs/promises").then(({ readFile }) => readFile(path!));
  const opened = await PDFDocument.load(bytes);
  expect(opened.getPageCount()).toBe(1);
  expect(opened.getForm().getFields()).toHaveLength(0);
});

test("Fill PDF form fits a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/pdf-forms");
  const metrics = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.inner + 1);
});
