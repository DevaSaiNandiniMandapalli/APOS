import { expect, test } from "@playwright/test";
import { PDFDocument } from "@cantoo/pdf-lib";
import { readFile } from "node:fs/promises";

const OCR_TEXT = "APOS SEARCHABLE TEST 2026";

/** Renders the sample text to a PNG in the browser so no image library is needed. */
async function sampleImage(page: import("@playwright/test").Page): Promise<Buffer> {
  const dataUrl = await page.evaluate((text) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 400;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000000";
    context.font = "bold 72px Arial, Helvetica, sans-serif";
    context.textBaseline = "middle";
    context.fillText(text, 60, canvas.height / 2);
    return canvas.toDataURL("image/png");
  }, OCR_TEXT);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

async function pdfText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= doc.numPages; index += 1) {
    const page = await doc.getPage(index);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  const pageCount = doc.numPages;
  await doc.cleanup();
  return { text: pages.join("\n"), pageCount };
}

test.describe("OCR to searchable PDF", () => {
  test("recognises a scanned page and writes a real, selectable text layer", async ({ page }) => {
    test.setTimeout(420000);

    // A one-page PDF whose only content is a picture of text, like a scan.
    const png = await sampleImage(page);
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(png);
    const pdfPage = pdf.addPage([700, 200]);
    pdfPage.drawImage(image, { x: 0, y: 0, width: 700, height: 200 });
    const scanned = Buffer.from(await pdf.save());

    await page.goto("/tools/ocr-pdf");
    await page.getByLabel("Choose a PDF to OCR").setInputFiles({
      name: "scan.pdf",
      mimeType: "application/pdf",
      buffer: scanned,
    });
    await page.getByRole("button", { name: "Extract text" }).click();

    // The first run downloads the English model (~15 MB).
    await expect(page.getByRole("button", { name: "Download searchable PDF" })).toBeVisible({ timeout: 360000 });

    // The plain-text output must contain the recognised words.
    const textArea = page.locator("#ocr-pdf-output");
    await expect(textArea).toBeVisible();
    const recognised = (await textArea.inputValue()).toUpperCase();
    expect(recognised).toContain("APOS");
    expect(recognised).toContain("2026");

    // The searchable PDF must carry a real text layer, not just the picture.
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download searchable PDF" }).click();
    const download = await pending;
    const path = await download.path();
    if (!path) throw new Error("searchable PDF was not saved");
    const bytes = new Uint8Array(await readFile(path));

    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    const { text, pageCount } = await pdfText(bytes);
    expect(pageCount).toBe(1);
    const layer = text.toUpperCase();
    expect(layer).toContain("APOS");
    expect(layer).toContain("SEARCHABLE");
    expect(layer).toContain("2026");
  });

  test("keeps pages that were not OCR'd unchanged", async ({ page }) => {
    test.setTimeout(420000);

    const png = await sampleImage(page);
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(png);
    const first = pdf.addPage([700, 200]);
    first.drawImage(image, { x: 0, y: 0, width: 700, height: 200 });
    pdf.addPage([700, 200]); // page 2: blank, not OCR'd

    await page.goto("/tools/ocr-pdf");
    await page.getByLabel("Choose a PDF to OCR").setInputFiles({
      name: "mixed.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await pdf.save()),
    });
    await page.getByLabel("Pages").fill("1");
    await page.getByRole("button", { name: "Extract text" }).click();
    await expect(page.getByRole("button", { name: "Download searchable PDF" })).toBeVisible({ timeout: 360000 });

    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download searchable PDF" }).click();
    const download = await pending;
    const path = await download.path();
    if (!path) throw new Error("searchable PDF was not saved");
    const bytes = new Uint8Array(await readFile(path));

    const { pageCount } = await pdfText(bytes);
    expect(pageCount).toBe(2);
  });
});
