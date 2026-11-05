import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { unzipSync, zipSync, strToU8 } from "fflate";

async function pdfWithText(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText("Payment terms are 30 days from invoice date.", { x: 60, y: 760, size: 12, font });
  page.drawText("Delivery happens within 14 working days.", { x: 60, y: 740, size: 12, font });
  return Buffer.from(await doc.save());
}

async function savedBytes(downloadPath: string | null): Promise<Uint8Array> {
  const { readFile } = await import("node:fs/promises");
  if (!downloadPath) throw new Error("Download was not saved.");
  return new Uint8Array(await readFile(downloadPath));
}

test("converts a text document into a paginated PDF", async ({ page }) => {
  await page.goto("/tools/document-to-pdf");
  await page.getByLabel("Choose a file").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("First paragraph.\n\nSecond paragraph with more words."),
  });
  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.locator(".merge-success")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download notes.pdf" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("notes.pdf");
  const bytes = await savedBytes(await download.path());
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  await expect(page.locator(".merge-success")).toContainText("2 paragraph(s)");
});

test("prints a CSV file as a PDF table", async ({ page }) => {
  await page.goto("/tools/spreadsheet-to-pdf");
  await page.getByLabel("Choose a file").setInputFiles({
    name: "costs.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Item,Amount\nRent,1200\nPower,80\n"),
  });
  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.locator(".merge-success")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download costs.pdf" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("costs.pdf");
  const bytes = await savedBytes(await download.path());
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  await expect(page.locator(".merge-success")).toContainText("3 row(s)");
});

test("converts PDF text into a Word document", async ({ page }) => {
  await page.goto("/tools/pdf-to-office");
  await page.getByLabel("Choose a file").setInputFiles({
    name: "terms.pdf",
    mimeType: "application/pdf",
    buffer: await pdfWithText(),
  });
  await page.getByRole("button", { name: "Convert PDF" }).click();
  await expect(page.locator(".merge-success")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download terms.docx" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("terms.docx");
  const entries = unzipSync(await savedBytes(await download.path()));
  const documentXml = new TextDecoder().decode(entries["word/document.xml"]);
  expect(documentXml).toContain("Payment terms are 30 days");
});

test("converts a presentation into a landscape PDF", async ({ page }) => {
  await page.goto("/tools/presentation-to-pdf");
  const deck = zipSync({
    "ppt/slides/slide1.xml": strToU8("<p:sld><a:p><a:r><a:t>Launch plan</a:t></a:r></a:p><a:p><a:r><a:t>Ship in June</a:t></a:r></a:p></p:sld>"),
  });
  await page.getByLabel("Choose a file").setInputFiles({ name: "deck.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: Buffer.from(deck) });
  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.locator(".merge-success")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download deck.pdf" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("deck.pdf");
  const bytes = await savedBytes(await download.path());
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  await expect(page.locator(".merge-success")).toContainText("1 slide(s)");
});

test("explains why a scanned PDF has no text to convert", async ({ page }) => {
  await page.goto("/tools/pdf-to-office");
  const blank = await PDFDocument.create();
  blank.addPage([595, 842]);
  await page.getByLabel("Choose a file").setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(await blank.save()) });
  await page.getByRole("button", { name: "Convert PDF" }).click();
  await expect(page.locator(".merge-error")).toContainText("OCR PDF");
});
