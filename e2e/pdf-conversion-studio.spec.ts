import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { unzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { buildDocxDocument } from "../src/lib/office-formats";

async function structurePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const first = pdf.addPage([595, 842]);
  first.drawText("Annual Report", { x: 50, y: 775, size: 24, font: bold, color: rgb(0.1, 0.1, 0.15) });
  first.drawText("Revenue grew by twelve percent this year.", { x: 50, y: 735, size: 12, font });
  first.drawText("Region", { x: 50, y: 700, size: 11, font: bold });
  first.drawText("Revenue", { x: 250, y: 700, size: 11, font: bold });
  first.drawText("North", { x: 50, y: 680, size: 11, font });
  first.drawText("1200", { x: 250, y: 680, size: 11, font });
  first.drawText("South", { x: 50, y: 660, size: 11, font });
  first.drawText("900", { x: 250, y: 660, size: 11, font });
  const second = pdf.addPage([595, 842]);
  second.drawText("Appendix", { x: 50, y: 775, size: 20, font: bold });
  second.drawText("Second page details are kept when all pages are selected.", { x: 50, y: 735, size: 12, font });
  return Buffer.from(await pdf.save());
}

async function pdfWithPicture(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const image = await pdf.embedPng(png);
  const page = pdf.addPage([500, 700]);
  page.drawText("Picture report", { x: 50, y: 650, size: 20, font });
  page.drawText("Text before the picture.", { x: 50, y: 610, size: 12, font });
  page.drawImage(image, { x: 100, y: 400, width: 180, height: 120 });
  page.drawText("Text after the picture.", { x: 50, y: 350, size: 12, font });
  return Buffer.from(await pdf.save());
}

async function downloadBytes(page: import("@playwright/test").Page, linkName: string | RegExp) {
  const event = page.waitForEvent("download");
  await page.getByRole("link", { name: linkName }).click();
  const download = await event;
  const path = await download.path();
  if (!path) throw new Error("Download was not saved.");
  return { bytes: new Uint8Array(await readFile(path)), name: download.suggestedFilename() };
}

async function chooseOfficePdf(page: import("@playwright/test").Page) {
  await page.getByLabel("Choose a file").setInputFiles({ name: "annual.pdf", mimeType: "application/pdf", buffer: await structurePdf() });
  await expect(page.getByRole("heading", { name: "Document preview" })).toBeVisible({ timeout: 20000 });
}

test("PDF to Office writes an editable Word document with headings, a real table and page boundaries", async ({ page }) => {
  await page.goto("/tools/pdf-to-office");
  await chooseOfficePdf(page);
  await page.getByLabel("Output filename").fill("annual-report");
  await page.getByRole("button", { name: "Convert PDF" }).click();
  await expect(page.locator(".merge-success")).toBeVisible({ timeout: 30000 });
  const { bytes, name } = await downloadBytes(page, "Download annual-report.docx");
  expect(name).toBe("annual-report.docx");
  const entries = unzipSync(bytes);
  const xml = new TextDecoder().decode(entries["word/document.xml"]);
  expect(xml).toContain("Annual Report");
  expect(xml).toContain("Revenue grew by twelve percent");
  expect(xml).toContain("<w:tbl>");
  expect(xml).toContain("North");
  expect(xml).toContain("1200");
  expect(xml).toContain('w:type="page"');
  expect(xml).toContain("Appendix");
  expect(xml).not.toContain("Second page details are kept when all pages are selected.Annual");
});

test("PDF to Office exports detected tables to Excel worksheets and honours a page range", async ({ page }) => {
  await page.goto("/tools/pdf-to-office");
  await chooseOfficePdf(page);
  await page.getByLabel("Format").selectOption("xlsx");
  await page.getByLabel("Pages").selectOption("custom");
  await page.getByLabel("Page range").fill("1");
  await page.getByLabel("Output filename").fill("annual-data");
  await page.getByRole("button", { name: "Convert PDF" }).click();
  await expect(page.locator(".merge-success")).toBeVisible({ timeout: 30000 });
  const { bytes, name } = await downloadBytes(page, "Download annual-data.xlsx");
  expect(name).toBe("annual-data.xlsx");
  const entries = unzipSync(bytes);
  const workbook = new TextDecoder().decode(entries["xl/workbook.xml"]);
  expect(workbook).toContain("Table 1");
  expect(workbook).toContain("Extracted text");
  const table = new TextDecoder().decode(entries["xl/worksheets/sheet1.xml"]);
  expect(table).toContain("Region");
  expect(table).toContain("North");
  expect(table).toContain("900");
  const allText = Object.entries(entries).filter(([key]) => key.startsWith("xl/worksheets/")).map(([, value]) => new TextDecoder().decode(value)).join("");
  expect(allText).not.toContain("Second page details");
});

test("PDF to Office visual mode embeds one page picture per page and no editable text", async ({ page }) => {
  await page.goto("/tools/pdf-to-office");
  await chooseOfficePdf(page);
  await page.getByLabel("Word mode").selectOption("visual");
  await page.getByLabel("Output filename").fill("annual-visual");
  await page.getByRole("button", { name: "Convert PDF" }).click();
  await expect(page.locator(".merge-success")).toBeVisible({ timeout: 30000 });
  const { bytes } = await downloadBytes(page, "Download annual-visual.docx");
  const entries = unzipSync(bytes);
  expect(Object.keys(entries).filter((name) => name.startsWith("word/media/"))).toHaveLength(2);
  const xml = new TextDecoder().decode(entries["word/document.xml"]);
  expect(xml).not.toContain("Extracted text (reference)");
  expect(xml).not.toContain("Annual Report");
  expect(xml).toContain("r:embed=\"rIdImg1\"");
});

test("PDF to Text extracts only the selected pages and shows a working preview", async ({ page }) => {
  await page.goto("/tools/pdf-to-text");
  await page.getByLabel("Choose PDF files").setInputFiles({ name: "annual.pdf", mimeType: "application/pdf", buffer: await structurePdf() });
  await page.getByLabel("Pages for annual.pdf").selectOption("custom");
  await page.getByLabel("Page range for annual.pdf").fill("2");
  await page.getByRole("button", { name: "Convert 1 queued file to text" }).click();
  await expect(page.getByLabel("Complete")).toHaveCount(1, { timeout: 30000 });
  const link = page.getByRole("link", { name: "annual.txt" });
  await expect(link).toBeVisible();
  await page.getByText("Preview extracted text").click();
  await expect(page.locator(".conversion-preview pre")).toContainText("Second page details");
  await expect(page.locator(".conversion-preview pre")).not.toContainText("Revenue grew");
  const { bytes } = await downloadBytes(page, "annual.txt");
  const text = new TextDecoder().decode(bytes);
  expect(text).toContain("--- Page 2 ---");
  expect(text).toContain("Second page details");
  expect(text).not.toContain("Annual Report");
});

test("PDF to Text reports empty pages and refuses to fake a successful empty file", async ({ page }) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([320, 420]).drawText("Readable page", { x: 30, y: 350, font });
  pdf.addPage([320, 420]);
  await page.goto("/tools/pdf-to-text");
  await page.getByLabel("Choose PDF files").setInputFiles([{ name: "partial.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) }]);
  await page.getByRole("button", { name: "Convert 1 queued file to text" }).click();
  await expect(page.getByLabel("Complete")).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator(".office-convert__warning")).toContainText("no selectable text");
  const blank = await PDFDocument.create(); blank.addPage([320, 420]);
  await page.getByRole("button", { name: "Clear batch" }).click();
  await page.getByLabel("Choose PDF files").setInputFiles([{ name: "blank.pdf", mimeType: "application/pdf", buffer: Buffer.from(await blank.save()) }]);
  await page.getByRole("button", { name: "Convert 1 queued file to text" }).click();
  await expect(page.getByLabel("Failed")).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator(".merge-error")).toContainText("No selectable text");
});

test("PDF to HTML produces semantic reading HTML, a layout mode and a complete ZIP package", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/tools/pdf-to-html");
  await page.getByLabel("Choose PDF files").setInputFiles({ name: "picture-report.pdf", mimeType: "application/pdf", buffer: await pdfWithPicture() });
  await page.getByRole("button", { name: "Convert 1 queued file to HTML" }).click();
  await expect(page.getByLabel("Complete")).toHaveCount(1, { timeout: 30000 });
  const reading = await downloadBytes(page, "picture-report.html");
  const html = new TextDecoder().decode(reading.bytes);
  expect(html).toContain("<h3 class=\"pdf-heading");
  expect(html).toContain("<figure>");
  expect(html).toContain("data:image/");
  expect(html).toContain("Content-Security-Policy");
  expect(html.indexOf("Text before the picture.")).toBeLessThan(html.indexOf("<img "));
  expect(html.indexOf("<img ")).toBeLessThan(html.indexOf("Text after the picture."));
  const packageDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: /Download ZIP package/ }).click();
  const packageEvent = await packageDownload;
  const packagePath = await packageEvent.path();
  expect(packagePath).toBeTruthy();
  const entries = unzipSync(new Uint8Array(await readFile(packagePath!)));
  expect(entries["index.html"]).toBeTruthy();
  expect(entries["README.txt"]).toBeTruthy();
  const assetNames = Object.keys(entries).filter((name) => name.startsWith("assets/"));
  expect(assetNames.length).toBeGreaterThan(0);
  const index = new TextDecoder().decode(entries["index.html"]);
  expect(index).toContain(assetNames[0]);
  expect(index).not.toContain("data:image/");
  await page.getByRole("button", { name: "Clear batch" }).click();
  await page.getByLabel("Choose PDF files").setInputFiles({ name: "picture-report.pdf", mimeType: "application/pdf", buffer: await pdfWithPicture() });
  await page.getByLabel("HTML mode").selectOption("layout");
  await page.getByRole("button", { name: "Convert 1 queued file to HTML" }).click();
  await expect(page.getByLabel("Complete")).toHaveCount(1, { timeout: 30000 });
  const layout = await downloadBytes(page, "picture-report.html");
  const layoutHtml = new TextDecoder().decode(layout.bytes);
  expect(layoutHtml).toContain("layout-line");
  expect(layoutHtml).toContain("layout-canvas");
});

test("PDF to Images renders a 300 DPI PNG with the chosen background and page thumbnails", async ({ page }) => {
  const pdf = await PDFDocument.create();
  const firstPage = pdf.addPage([72, 72]);
  firstPage.drawRectangle({ x: 10, y: 10, width: 52, height: 52, color: rgb(0.1, 0.3, 0.7) });
  await page.goto("/tools/pdf-to-images");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "parcel.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator(".pdf-page-grid img")).toHaveCount(1, { timeout: 20000 });
  await page.getByLabel("Resolution").selectOption("300");
  await page.getByLabel("Background colour").fill("#ffeeaa");
  await page.getByLabel("Output filename prefix").fill("parcel-print");
  await page.getByRole("button", { name: "Convert to images" }).click();
  await expect(page.getByText(/Validated 1 image/)).toBeVisible({ timeout: 30000 });
  const link = page.locator(".merge-success li a");
  expect(await link.getAttribute("download")).toBe("parcel-print-page-0001.png");
  const href = await link.getAttribute("href");
  const result = await page.evaluate(async (url) => {
    const bitmap = await createImageBitmap(await (await fetch(url!)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const pixel = [...context.getImageData(0, 0, 1, 1).data];
    const dimensions = [bitmap.width, bitmap.height];
    bitmap.close();
    return { pixel, dimensions };
  }, href);
  expect(result.dimensions).toEqual([300, 300]);
  expect(result.pixel[0]).toBeGreaterThan(240);
  expect(result.pixel[1]).toBeGreaterThan(220);
  expect(result.pixel[2]).toBeGreaterThan(150);
  expect(result.pixel[2]).toBeLessThan(200);
});

test("Images to PDF applies page size, orientation, margins and a custom filename", async ({ page }) => {
  await page.goto("/tools/images-to-pdf");
  const encoded = await page.evaluate(() => {
    const portrait = document.createElement("canvas"); portrait.width = 40; portrait.height = 80;
    const landscape = document.createElement("canvas"); landscape.width = 80; landscape.height = 40;
    return [portrait.toDataURL("image/png").split(",")[1], landscape.toDataURL("image/jpeg", 0.9).split(",")[1]];
  });
  await page.getByLabel("Choose JPG or PNG images").setInputFiles([
    { name: "portrait.png", mimeType: "image/png", buffer: Buffer.from(encoded[0], "base64") },
    { name: "landscape.jpg", mimeType: "image/jpeg", buffer: Buffer.from(encoded[1], "base64") },
  ]);
  await expect(page.getByText("portrait.png", { exact: false })).toBeVisible();
  await page.getByLabel("Page size").selectOption("a5");
  await page.getByLabel("Orientation").selectOption("landscape");
  await page.getByLabel("Margins").selectOption("medium");
  await page.getByLabel("Image placement").selectOption("fit");
  await page.getByLabel("Background colour").fill("#f0f4ff");
  await page.getByLabel("Output filename").fill("a5-album.pdf");
  await page.getByRole("button", { name: "Create PDF" }).click();
  const link = page.getByRole("link", { name: /Download validated PDF/ });
  await expect(link).toBeVisible({ timeout: 30000 });
  const href = await link.getAttribute("href");
  const bytes = await page.evaluate(async (url) => new Uint8Array(await (await fetch(url!)).arrayBuffer()), href);
  const output = await PDFDocument.load(bytes);
  expect(output.getPageCount()).toBe(2);
  for (const page of output.getPages()) {
    expect(page.getWidth()).toBeGreaterThan(page.getHeight());
    expect(page.getWidth()).toBeCloseTo(595.28, 1);
    expect(page.getHeight()).toBeCloseTo(419.53, 1);
  }
  expect(await page.getByRole("button", { name: "Remove portrait.png" }).count()).toBe(1);
  await page.getByRole("button", { name: "Remove portrait.png" }).click();
  await expect(page.getByText("portrait.png", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByLabel("Choose JPG or PNG images")).toBeVisible();
});

test("PDF to Office remains usable and accessible in dark mode on mobile", async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/pdf-to-office");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await chooseOfficePdf(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("PDF to Office rejects non-PDF and corrupt inputs without exposing a download", async ({ page }) => {
  await page.goto("/tools/pdf-to-office");
  await page.getByLabel("Choose a file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a PDF") });
  await expect(page.locator(".merge-error")).toContainText("PDF signature");
  await expect(page.getByRole("link", { name: /Download .*\.(docx|xlsx)/ })).toHaveCount(0);
  await page.getByLabel("Choose a file").setInputFiles({ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 malformed structure") });
  await expect(page.locator(".merge-error").first()).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Convert PDF" }).click();
  await expect(page.getByRole("link", { name: /Download .*\.(docx|xlsx)/ })).toHaveCount(0);
});

test("PDF to HTML supports image-only pages honestly and warns that OCR is needed", async ({ page }) => {
  test.setTimeout(60000);
  const pdf = await PDFDocument.create();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const image = await pdf.embedPng(png);
  const page1 = pdf.addPage([400, 500]);
  page1.drawImage(image, { x: 50, y: 100, width: 250, height: 300 });
  await page.goto("/tools/pdf-to-html");
  await page.getByLabel("Choose PDF files").setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "Convert 1 queued file to HTML" }).click();
  await expect(page.getByLabel("Complete")).toHaveCount(1, { timeout: 30000 });
  await expect(page.locator(".office-convert__warning")).toContainText("no selectable text");
  const { bytes } = await downloadBytes(page, "scan.html");
  const html = new TextDecoder().decode(bytes);
  expect(html).toContain("<figure>");
  expect(html).toContain("<img ");
  expect(html).not.toContain("text after");
});

test("PDF to Text preserves UTF-8 text from a real PDF", async ({ page }) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([320, 420]).drawText("naive facade cafe", { x: 30, y: 350, size: 14, font });
  pdf.addPage([320, 420]).drawText("naïve façade café", { x: 30, y: 350, size: 14, font });
  await page.goto("/tools/pdf-to-text");
  await page.getByLabel("Choose PDF files").setInputFiles({ name: "unicode.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "Convert 1 queued file to text" }).click();
  await expect(page.getByLabel("Complete")).toHaveCount(1, { timeout: 30000 });
  const { bytes } = await downloadBytes(page, "unicode.txt");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  expect(text).toContain("naïve façade café");
  expect(text).toContain("--- Page 2 ---");
});

test("PDF to Office can use the layout-preserving server engine", async ({ page }) => {
  const docx = buildDocxDocument([{ kind: "paragraph", text: "Server converted text" }], "Server");
  await page.route("**/api/v1/tools", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: "test", max_upload_mb: 50, max_files: 20, processing_server: true,
        tools: [
          { name: "pdf_to_word", label: "PDF → Word", description: "Layout-preserving server conversion.", available: true, accepts: ".pdf", min_files: 1, options: [] },
          { name: "ocr", label: "OCR", description: "OCR", available: false },
        ],
      }),
    });
  });
  await page.route("**/api/v1/tools/pdf_to_word", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "content-disposition": "attachment; filename*=UTF-8''server.docx" },
      body: Buffer.from(docx),
    });
  });
  await page.goto("/tools/pdf-to-office");
  await chooseOfficePdf(page);
  await expect(page.getByLabel("Word engine").getByRole("option", { name: /Layout-preserving server/ })).toBeAttached();
  await page.getByLabel("Word engine").selectOption("server");
  await expect(page.getByText(/Layout-preserving mode uploads this PDF/i)).toBeVisible();
  await page.getByRole("button", { name: "Convert PDF" }).click();
  await expect(page.locator(".merge-success")).toBeVisible({ timeout: 30000 });
  const { bytes, name } = await downloadBytes(page, "Download annual.docx");
  expect(name).toBe("annual.docx");
  const xml = new TextDecoder().decode(unzipSync(bytes)["word/document.xml"]);
  expect(xml).toContain("Server converted text");
});

test("real FastAPI layout engine converts PDF to Word through the main UI", async ({ page }) => {
  test.setTimeout(120000);
  test.skip(!process.env.APOS_LIVE_BACKEND, "Requires the local FastAPI processing server on port 8000.");
  await page.route("**/api/v1/**", async (route) => {
    const target = route.request().url().replace("http://localhost:3000", "http://127.0.0.1:8000");
    const response = await route.fetch({ url: target });
    await route.fulfill({ response });
  });
  await page.goto("/tools/pdf-to-office");
  await chooseOfficePdf(page);
  await expect(page.getByLabel("Word engine").getByRole("option", { name: /Layout-preserving server/ })).toBeAttached({ timeout: 20000 });
  await page.getByLabel("Word engine").selectOption("server");
  await page.getByRole("button", { name: "Convert PDF" }).click();
  await expect(page.locator(".merge-success")).toBeVisible({ timeout: 60000 });
  const { bytes } = await downloadBytes(page, "Download annual.docx");
  const xml = new TextDecoder().decode(unzipSync(bytes)["word/document.xml"]);
  expect(xml).toContain("Annual Report");
  expect(xml).toContain("Revenue");
});

test("Editable Word anchors pictures at their original PDF coordinates", async ({ page }) => {
  await page.goto("/tools/pdf-to-office");
  await page.getByLabel("Choose a file").setInputFiles({ name: "picture-layout.pdf", mimeType: "application/pdf", buffer: await pdfWithPicture() });
  await expect(page.getByRole("heading", { name: "Document preview" })).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Convert PDF" }).click();
  await expect(page.locator(".merge-success")).toBeVisible({ timeout: 30000 });
  const { bytes } = await downloadBytes(page, "Download picture-layout.docx");
  const entries = unzipSync(bytes);
  const xml = new TextDecoder().decode(entries["word/document.xml"]);
  expect(xml).toContain("<wp:anchor");
  expect(xml).toContain('behindDoc="1"');
  expect(xml).toContain("<wp:positionH");
  expect(xml).toContain("<wp:positionV");
  expect(xml).toContain("Text before the picture.");
  expect(xml).toContain("Text after the picture.");
  expect(Object.keys(entries).some((name) => name.startsWith("word/media/"))).toBe(true);
});
