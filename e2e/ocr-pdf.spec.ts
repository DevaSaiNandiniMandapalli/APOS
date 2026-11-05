import { expect, test } from "@playwright/test";
import { PDFDocument } from "@cantoo/pdf-lib";

async function makePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  return Buffer.from(await pdf.save());
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tools/ocr-pdf");
  await expect(page.getByRole("heading", { level: 1, name: "OCR PDF" })).toBeVisible();
});

test("rejects files without a PDF signature", async ({ page }) => {
  await page.getByLabel("Choose a PDF to OCR").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a pdf"),
  });
  await expect(page.locator(".ocr__message")).toContainText("does not have a PDF signature");
  await expect(page.getByRole("button", { name: "Extract text" })).toBeDisabled();
});

test("accepts a real PDF and enables extraction", async ({ page }) => {
  await page.getByLabel("Choose a PDF to OCR").setInputFiles({
    name: "scanned.pdf",
    mimeType: "application/pdf",
    buffer: await makePdf(),
  });
  await expect(page.getByRole("button", { name: "Extract text" })).toBeEnabled();
});
