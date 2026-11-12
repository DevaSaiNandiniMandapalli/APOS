import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { degrees, PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { unzipSync } from "fflate";
import { toolDefinitions } from "../src/lib/registry";
import { validatePdfWithPdfJs } from "./pdf-js-validation";

const MIXED_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWP4z8DwHx9moL0CAHD0P8FDxlD6AAAAAElFTkSuQmCC";

async function makeMixedPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const image = await pdf.embedPng(Buffer.from(MIXED_PNG, "base64"));
  const portrait = pdf.addPage([300, 400]);
  portrait.drawText("Portrait page", { x: 24, y: 340, size: 14, font });
  const landscape = pdf.addPage([500, 300]);
  landscape.drawText("Landscape page", { x: 24, y: 240, size: 14, font });
  const picture = pdf.addPage([320, 480]);
  picture.drawImage(image, { x: 24, y: 300, width: 80, height: 40 });
  const rotated = pdf.addPage([600, 350]);
  rotated.drawText("Rotated source page", { x: 24, y: 280, size: 14, font });
  rotated.setRotation(degrees(90));
  return Buffer.from(await pdf.save());
}

test("search is keyboard accessible and its result opens the tool route", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Control+k");
  const search = page.getByRole("textbox", { name: "Search tools" });
  await expect(search).toBeFocused();
  await search.fill("merge");
  await expect(page.getByRole("heading", { name: "Merge PDF" })).toBeVisible();
  await expect(page.getByText("Available").first()).toBeVisible();
  await page.getByRole("link", { name: /Merge PDF/ }).first().click();
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);
  await expect(page.getByRole("heading", { name: "Merge PDFs on this device" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);
});

test("each studio route resolves to its registry studio", async ({ page }) => {
  const studios = [["pdf-essentials", "PDF Essentials"], ["pdf-conversion", "PDF Conversion"], ["pdf-editor", "PDF Editor"], ["pdf-organizer-layout", "PDF Organizer & Layout"], ["pdf-security-signature", "PDF Security & Signature"], ["pdf-repair-optimization", "PDF Repair & Optimization"], ["image-studio", "Image Studio"], ["ocr-scanning-studio", "OCR & Scanning Studio"], ["document-studio", "Document Studio"], ["spreadsheet-studio", "Spreadsheet Studio"], ["presentation-studio", "Presentation Studio"], ["ai-studio", "AI Studio"], ["automation-studio", "Automation Studio"], ["utility-studio", "Utility Studio"], ["developer-studio", "Developer Studio"]];
  for (const [id, name] of studios) {
    await page.goto(`/studios/${id}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  }
});

test("every registry tool has a working route and honest status presentation", async ({ page }) => {
  for (const tool of toolDefinitions) {
    await page.goto(`/tools/${tool.id}`);
    await expect(page.getByRole("heading", { level: 1, name: tool.name })).toBeVisible();
    if (tool.status === "planned") {
      await expect(page.getByText("This tool is not ready yet")).toBeVisible();
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
    }
    if (tool.id === "edit-pdf") {
      await expect(page.getByText("Available · text editing in the browser")).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "PDF Viewer" })).toBeVisible();
      await expect(page.locator('input[type="file"]')).toHaveCount(1);
    }
    if (tool.id === "pdf-to-text") {
      await expect(page.getByText("Available · browser-local batch conversion")).toBeVisible();
      await expect(page.getByLabel("Choose PDF files")).toBeVisible();
    }
  }
});

test("Edit PDF rejects a file whose content lacks a PDF signature", async ({ page }) => {
  await page.goto("/tools/edit-pdf");
  await expect(page.getByText("Available · text editing in the browser")).toBeVisible();
  await page.getByLabel("Choose PDF").setInputFiles({
    name: "not-really.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("This file is not a PDF."),
  });
  await expect(page.locator(".merge-error")).toContainText("does not have a valid PDF signature");
  await expect(page.getByRole("heading", { level: 2, name: "PDF Viewer" })).toBeVisible();
});

test("PDF to text extracts real page text, resolves duplicate names, archives outputs and reports unsupported mixed inputs", async ({ page }) => {
  const makeTextPdf = async (texts: string[]) => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    texts.forEach((text, index) => pdf.addPage([320, 420]).drawText(text, { x: 30, y: 340 - index * 20, size: 14, font }));
    return Buffer.from(await pdf.save());
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/pdf-to-text");
  await page.getByLabel("Choose PDF files").setInputFiles([
    { name: "report.pdf", mimeType: "application/pdf", buffer: await makeTextPdf(["Alpha page one", "Alpha page two"]) },
    { name: "report.pdf", mimeType: "application/pdf", buffer: await makeTextPdf(["Beta page"]) },
    { name: "photo.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]) },
  ]);
  await expect(page.getByLabel("Output filename for report.pdf")).toHaveCount(2);
  await expect(page.getByText(/signature identifies PNG, for which this batch has no verified converter yet/)).toBeVisible();
  await page.getByLabel("Output filename for report.pdf").nth(0).fill("summary");
  await page.getByLabel("Output filename for report.pdf").nth(1).fill("summary");
  await page.getByLabel("Page headings for report.pdf").nth(1).selectOption("omit");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole("button", { name: "Convert 2 queued files to text" }).click();
  await expect(page.getByLabel("Complete")).toHaveCount(2, { timeout: 30000 });
  await expect(page.getByLabel("Failed")).toHaveCount(1);
  const outputs = page.getByRole("link", { name: /summary(?: \(2\))?\.txt/ });
  await expect(outputs).toHaveCount(2);
  const outputEvent = page.waitForEvent("download");
  await outputs.nth(0).click();
  const outputDownload = await outputEvent;
  expect(outputDownload.suggestedFilename()).toBe("summary.txt");
  const outputStream = await outputDownload.createReadStream();
  const outputChunks: Buffer[] = [];
  for await (const chunk of outputStream!) outputChunks.push(Buffer.from(chunk));
  const firstText = Buffer.concat(outputChunks).toString("utf8");
  expect(firstText).toContain("--- Page 1 ---");
  expect(firstText).toContain("Alpha page one");
  expect(firstText).toContain("--- Page 2 ---");
  await page.getByRole("button", { name: "Download completed files as ZIP" }).click();
  const zipLink = page.getByRole("link", { name: "Download completed files as ZIP" });
  await expect(zipLink).toBeVisible();
  const zipEvent = page.waitForEvent("download");
  await zipLink.click();
  const zipDownload = await zipEvent;
  expect(zipDownload.suggestedFilename()).toBe("apos-converted-text.zip");
  const zipStream = await zipDownload.createReadStream();
  const zipChunks: Buffer[] = [];
  for await (const chunk of zipStream!) zipChunks.push(Buffer.from(chunk));
  const archived = unzipSync(Buffer.concat(zipChunks));
  expect(Object.keys(archived)).toEqual(["summary.txt", "summary (2).txt"]);
  expect(Buffer.from(archived["summary (2).txt"]).toString("utf8")).toContain("Beta page");
  expect(Buffer.from(archived["summary (2).txt"]).toString("utf8")).not.toContain("Page 1");
  await page.getByRole("button", { name: "Download error report" }).click();
  const reportLink = page.getByRole("link", { name: "Download error report" });
  await expect(reportLink).toBeVisible();
  const reportEvent = page.waitForEvent("download");
  await reportLink.click();
  const reportDownload = await reportEvent;
  const reportStream = await reportDownload.createReadStream();
  const reportChunks: Buffer[] = [];
  for await (const chunk of reportStream!) reportChunks.push(Buffer.from(chunk));
  expect(Buffer.concat(reportChunks).toString("utf8")).toContain("photo.png — Failed");
});

test("PDF to text retries failed items, skips unsupported items and releases output URLs", async ({ page }) => {
  await page.addInitScript(() => {
    const created: string[] = []; const revoked: string[] = [];
    const create = URL.createObjectURL.bind(URL); const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => { const url = create(object); created.push(url); return url; };
    URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
    Object.defineProperty(window, "__textUrls", { value: { created, revoked } });
  });
  await page.goto("/tools/pdf-to-text");
  await page.getByLabel("Choose PDF files").setInputFiles([
    { name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 invalid structure") },
    { name: "unknown.dat", mimeType: "application/octet-stream", buffer: Buffer.from("no recognized header") },
  ]);
  await expect(page.getByLabel("Failed")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Convert 1 queued file to text" })).toBeEnabled();
  await page.getByRole("button", { name: "Convert 1 queued file to text" }).click();
  await expect(page.getByLabel("Failed")).toHaveCount(2, { timeout: 20000 });
  await page.getByRole("button", { name: "Retry" }).first().click();
  await expect(page.getByLabel("Failed")).toHaveCount(2, { timeout: 20000 });
  await page.getByRole("button", { name: "Skip" }).first().click();
  await expect(page.getByLabel("Skipped")).toHaveCount(1);
  await page.getByRole("button", { name: "Download error report" }).click();
  await expect(page.getByRole("link", { name: "Download error report" })).toBeVisible();
  await page.getByRole("button", { name: "Clear batch" }).click();
  const urls = await page.evaluate(() => (window as unknown as { __textUrls: { created: string[]; revoked: string[] } }).__textUrls);
  expect(urls.created.length).toBeGreaterThan(0);
  expect(urls.revoked).toEqual(expect.arrayContaining(urls.created));
});

test("PDF to text cancellation terminates the PDF.js worker without partial downloads", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker; const terminate = Worker.prototype.terminate;
    Object.defineProperty(window, "__textWorkerStarts", { value: 0, writable: true });
    Object.defineProperty(window, "__textWorkerStops", { value: 0, writable: true });
    window.Worker = class extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) { super(...args); (window as unknown as { __textWorkerStarts: number }).__textWorkerStarts += 1; }
    } as typeof Worker;
    Worker.prototype.terminate = function () { (window as unknown as { __textWorkerStops: number }).__textWorkerStops += 1; return terminate.call(this); };
  });
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let page = 0; page < 30; page += 1) pdf.addPage([320, 420]).drawText(`Text page ${page + 1}`, { x: 20, y: 350, font });
  await page.goto("/tools/pdf-to-text");
  await page.getByLabel("Choose PDF files").setInputFiles({ name: "many.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "Convert 1 queued file to text" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __textWorkerStarts: number }).__textWorkerStarts), { timeout: 30000 }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Cancel batch" }).click();
  await expect(page.getByLabel("Cancelled")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __textWorkerStops: number }).__textWorkerStops)).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: /\.txt$/ })).toHaveCount(0);
});

test("PDF to text ZIP cancellation terminates its worker and keeps individual outputs", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker; const terminate = Worker.prototype.terminate; const postMessage = Worker.prototype.postMessage;
    const timers = new Map<Worker, number>();
    Object.defineProperty(window, "__textZipWorkerStops", { value: 0, writable: true });
    window.Worker = class extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) { super(...args); }
    } as typeof Worker;
    Worker.prototype.postMessage = function (message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
      if (!message || typeof message !== "object" || !("files" in message)) return Reflect.apply(postMessage, this, [message, transfer]);
      const timer = window.setTimeout(() => { timers.delete(this); Reflect.apply(postMessage, this, [message, transfer]); }, 1000);
      timers.set(this, timer);
    };
    Worker.prototype.terminate = function () {
      const timer = timers.get(this);
      if (timer !== undefined) { window.clearTimeout(timer); timers.delete(this); (window as unknown as { __textZipWorkerStops: number }).__textZipWorkerStops += 1; }
      return terminate.call(this);
    };
  });
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([300, 400]).drawText("Keep this individual output", { x: 20, y: 350, font });
  await page.goto("/tools/pdf-to-text");
  await page.getByLabel("Choose PDF files").setInputFiles({ name: "one.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "Convert 1 queued file to text" }).click();
  await expect(page.getByLabel("Complete")).toHaveCount(1, { timeout: 20000 });
  await page.getByRole("button", { name: "Download completed files as ZIP" }).click();
  await page.getByRole("button", { name: "Cancel ZIP creation" }).click();
  await expect(page.locator(".merge-error")).toContainText("ZIP creation cancelled");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __textZipWorkerStops: number }).__textZipWorkerStops)).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: "one.txt" })).toBeVisible();
});

test("PDF to text handles a 20-file batch and remains accessible on mobile", async ({ page }) => {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([300, 400]).drawText("Batch item", { x: 20, y: 350, font });
  const bytes = Buffer.from(await pdf.save());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/pdf-to-text");
  await page.getByLabel("Choose PDF files").setInputFiles(Array.from({ length: 20 }, (_, index) => ({ name: `batch-${index + 1}.pdf`, mimeType: "application/pdf", buffer: bytes })));
  await expect(page.getByRole("listitem")).toHaveCount(20);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole("button", { name: "Convert 20 queued files to text" }).click();
  await expect(page.getByLabel("Complete")).toHaveCount(20, { timeout: 120000 });
  await expect(page.getByRole("button", { name: "Download completed files as ZIP" })).toBeEnabled();
});

test("PDF to HTML creates a validated HTML reading view and escapes document text", async ({ page }) => {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([320, 420]).drawText("Safe <tag> & text", { x: 20, y: 350, font });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/pdf-to-html");
  await expect(page.getByText("Turn selectable PDF text into a safe, responsive HTML document.")).toBeVisible();
  await page.getByLabel("Choose PDF files").setInputFiles({ name: "source.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "Convert 1 queued file to HTML" }).click();
  await expect(page.getByLabel("Complete")).toHaveCount(1, { timeout: 20000 });
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "source.html" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("source.html");
  const stream = await download.createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const html = Buffer.concat(chunks).toString("utf8");
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("&lt;tag&gt; &amp; text");
  expect(html).not.toContain("<tag>");
  expect(html).toContain("<main>");
  expect(html).toContain("<section class=\"page\" id=\"page-1\"");
  expect(html).toContain("Content-Security-Policy");
});

test("merge rejects files without PDF signatures and leaves no download", async ({ page }) => {
  await page.goto("/tools/merge-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a PDF") });
  await expect(page.locator(".merge-error")).toContainText("does not have a PDF signature");
  await expect(page.getByRole("link", { name: "merged.pdf" })).toHaveCount(0);
});

test("merge processes real PDF fixtures and downloads a validated combined document", async ({ page }) => {
  const makePdf = async (width: number, height: number) => {
    const pdf = await PDFDocument.create();
    pdf.addPage([width, height]);
    return Buffer.from(await pdf.save());
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/merge-pdf");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "first.pdf", mimeType: "application/pdf", buffer: await makePdf(300, 400) },
    { name: "second.pdf", mimeType: "application/pdf", buffer: await makePdf(500, 600) },
  ]);
  await expect(page.getByRole("list", { name: "PDF merge order" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.locator(".pdf-merge-thumb img")).toHaveCount(2, { timeout: 20000 });
  await expect(page.locator(".pdf-merge-copy").nth(1)).toContainText("1 page");
  await page.getByRole("button", { name: "Move second.pdf up" }).click();
  await page.getByLabel("Output filename").fill("combined.pdf");
  const a11y = await new AxeBuilder({ page }).analyze();
  expect(a11y.violations).toEqual([]);
  await page.getByRole("button", { name: "Merge PDFs" }).click();
  await expect(page.getByText(/Validated merged PDF · 2 pages/)).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "combined.pdf" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("combined.pdf");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const downloadedBytes = Buffer.concat(chunks);
  const output = await PDFDocument.load(downloadedBytes);
  expect(output.getPages().map((pdfPage) => pdfPage.getSize())).toEqual([{ width: 500, height: 600 }, { width: 300, height: 400 }]);
  await validatePdfWithPdfJs(new Uint8Array(downloadedBytes), {
    expectedPageCount: 2,
    expectedSizes: [{ width: 500, height: 600 }, { width: 300, height: 400 }],
  });
});

test("merge cancellation terminates its worker without exposing a partial download", async ({ page }) => {
  await page.addInitScript(() => {
    const prototype = Worker.prototype;
    const postMessage = prototype.postMessage;
    const terminate = prototype.terminate;
    const tracked = new WeakSet<Worker>();
    Object.defineProperty(window, "__mergeWorkerTerminated", { value: false, writable: true });
    Object.defineProperty(prototype, "postMessage", { value: function (this: Worker, message: unknown, transfer?: Transferable[]) {
      if (message && typeof message === "object" && "files" in message) {
        tracked.add(this);
        window.setTimeout(() => Reflect.apply(postMessage, this, [message, transfer]), 1000);
        return;
      }
      return Reflect.apply(postMessage, this, [message, transfer]);
    } });
    prototype.terminate = function () {
      if (tracked.has(this)) (window as unknown as { __mergeWorkerTerminated: boolean }).__mergeWorkerTerminated = true;
      return terminate.call(this);
    };
  });
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  const fixture = Buffer.from(await pdf.save());
  await page.goto("/tools/merge-pdf");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "one.pdf", mimeType: "application/pdf", buffer: fixture },
    { name: "two.pdf", mimeType: "application/pdf", buffer: fixture },
  ]);
  await page.getByRole("button", { name: "Merge PDFs" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".merge-error")).toContainText("Merge cancelled");
  expect(await page.evaluate(() => (window as unknown as { __mergeWorkerTerminated: boolean }).__mergeWorkerTerminated)).toBe(true);
  await expect(page.getByRole("link", { name: "merged.pdf" })).toHaveCount(0);
});

test("merge revokes its generated object URL when its output is cleared", async ({ page }) => {
  await page.addInitScript(() => {
    const created: string[] = [];
    const revoked: string[] = [];
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => { const url = create(object); created.push(url); return url; };
    URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
    Object.defineProperty(window, "__mergeObjectUrls", { value: { created, revoked } });
  });
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  const fixture = Buffer.from(await pdf.save());
  await page.goto("/tools/merge-pdf");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "one.pdf", mimeType: "application/pdf", buffer: fixture },
    { name: "two.pdf", mimeType: "application/pdf", buffer: fixture },
  ]);
  await page.getByRole("button", { name: "Merge PDFs" }).click();
  await expect(page.getByRole("link", { name: "merged.pdf" })).toBeVisible();
  const created = await page.evaluate(() => (window as unknown as { __mergeObjectUrls: { created: string[] } }).__mergeObjectUrls.created);
  expect(created).toHaveLength(1);
  await page.getByRole("button", { name: "Remove one.pdf" }).click();
  const revoked = await page.evaluate(() => (window as unknown as { __mergeObjectUrls: { revoked: string[] } }).__mergeObjectUrls.revoked);
  expect(revoked).toContain(created[0]);
  await expect(page.getByRole("link", { name: "merged.pdf" })).toHaveCount(0);
});

test("merge accepts dropped files, reorders by drag and clears all", async ({ page }) => {
  const first = await PDFDocument.create(); first.addPage([300, 400]);
  const second = await PDFDocument.create(); second.addPage([500, 600]);
  const a = Buffer.from(await first.save()).toString("base64");
  const b = Buffer.from(await second.save()).toString("base64");
  await page.goto("/tools/merge-pdf");
  await page.evaluate(({ a, b }) => {
    const files = [a, b].map((base64, index) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let offset = 0; offset < binary.length; offset += 1) bytes[offset] = binary.charCodeAt(offset);
      return new File([bytes], index === 0 ? "drop-a.pdf" : "drop-b.pdf", { type: "application/pdf" });
    });
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    const zone = document.querySelector(".pdf-dropzone");
    if (!zone) throw new Error("drop zone missing");
    zone.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { a, b });
  await expect(page.getByRole("list", { name: "PDF merge order" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.locator(".merge-filename").first()).toHaveText("drop-a.pdf");
  await page.evaluate(() => {
    const items = document.querySelectorAll(".pdf-merge-list li");
    const transfer = new DataTransfer();
    items[0].dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    items[1].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    items[1].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    items[0].dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.locator(".merge-filename").first()).toHaveText("drop-b.pdf");
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByRole("list", { name: "PDF merge order" })).toHaveCount(0);
});

test("split, rotate, watermark and page-number tools accept a dropped PDF", async ({ page }) => {
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]);
  const base64 = Buffer.from(await pdf.save()).toString("base64");
  for (const route of ["split-pdf", "rotate-pdf", "pdf-watermark", "pdf-page-numbers"]) {
    await page.goto(`/tools/${route}`);
    await page.locator(".pdf-dropzone").waitFor({ timeout: 10000 });
    await page.evaluate(({ base64 }) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const file = new File([bytes], "dropped.pdf", { type: "application/pdf" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const zone = document.querySelector(".pdf-dropzone");
      if (!zone) throw new Error("drop zone missing");
      zone.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, { base64 });
    await expect(page.locator(".pdf-file-summary")).toContainText("dropped.pdf", { timeout: 10000 });
  }
});

test("merge enforces the file-count and page-total limits", async ({ page }) => {
  const one = await PDFDocument.create(); one.addPage([300, 400]);
  const oneBuffer = Buffer.from(await one.save());
  await page.goto("/tools/merge-pdf");
  await page.locator('input[type="file"]').setInputFiles(Array.from({ length: 11 }, (_, index) => ({ name: `limit-${index + 1}.pdf`, mimeType: "application/pdf", buffer: oneBuffer })));
  await expect(page.locator(".merge-error")).toContainText("no more than 10");
  await expect(page.getByRole("list", { name: "PDF merge order" })).toHaveCount(0);

  const large = await PDFDocument.create();
  for (let index = 0; index < 501; index += 1) large.addPage([200, 200]);
  await page.locator('input[type="file"]').setInputFiles([
    { name: "large.pdf", mimeType: "application/pdf", buffer: Buffer.from(await large.save()) },
    { name: "small.pdf", mimeType: "application/pdf", buffer: oneBuffer },
  ]);
  await expect(page.locator(".merge-error")).toContainText("limit is 500", { timeout: 30000 });
  await expect(page.getByRole("button", { name: "Merge PDFs" })).toBeDisabled();
});

test("split creates real validated page-range downloads", async ({ page }) => {
  const source = await PDFDocument.create();
  source.addPage([300, 400]); source.addPage([500, 600]); source.addPage([700, 800]);
  const fixture = Buffer.from(await source.save());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/split-pdf");
  await expect(page.getByRole("heading", { name: "Split PDF", exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: fixture });
  await expect(page.locator(".pdf-file-summary")).toContainText("report.pdf");
  await expect(page.locator(".pdf-file-summary")).toContainText("3 pages", { timeout: 20000 });
  await page.getByLabel("Page ranges").fill("3, 1-2");
  const a11y = await new AxeBuilder({ page }).analyze();
  expect(a11y.violations).toEqual([]);
  await page.getByRole("button", { name: "Split PDF" }).click();
  await expect(page.getByText(/Validated 2 PDF file/)).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: /report-pages-3-3.pdf/ }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("report-pages-3-3.pdf");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const downloadedBytes = Buffer.concat(chunks);
  const output = await PDFDocument.load(downloadedBytes);
  expect(output.getPages().map((pdfPage) => pdfPage.getSize())).toEqual([{ width: 700, height: 800 }]);
  await validatePdfWithPdfJs(new Uint8Array(downloadedBytes), {
    expectedPageCount: 1,
    expectedSizes: [{ width: 700, height: 800 }],
  });
});

test("split supports individual pages, equal groups, extraction and ZIP integrity", async ({ page }) => {
  const source = await PDFDocument.create();
  source.addPage([300, 400]); source.addPage([500, 600]); source.addPage([700, 800]);
  const fixture = Buffer.from(await source.save());
  await page.goto("/tools/split-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "batch.pdf", mimeType: "application/pdf", buffer: fixture });
  await expect(page.locator(".pdf-file-summary")).toContainText("3 pages", { timeout: 20000 });

  await page.getByLabel("Split mode").selectOption("individual");
  await page.getByRole("button", { name: "Split every page" }).click();
  await expect(page.locator(".pdf-result-list a")).toHaveCount(3, { timeout: 30000 });
  await expect(page.getByRole("link", { name: "batch-page-0002.pdf" })).toBeVisible();
  await page.getByRole("button", { name: "Create ZIP of all outputs" }).click();
  await expect(page.getByRole("link", { name: "Download all as ZIP" })).toBeVisible({ timeout: 20000 });
  const zipEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download all as ZIP" }).click();
  const zipDownload = await zipEvent;
  const zipStream = await zipDownload.createReadStream();
  const zipChunks: Buffer[] = [];
  for await (const chunk of zipStream!) zipChunks.push(Buffer.from(chunk));
  const entries = unzipSync(Buffer.concat(zipChunks));
  expect(Object.keys(entries).sort()).toEqual(["batch-page-0001.pdf", "batch-page-0002.pdf", "batch-page-0003.pdf"]);
  expect(entries["batch-page-0002.pdf"].byteLength).toBeGreaterThan(20);
  const zipSizes = [{ width: 300, height: 400 }, { width: 500, height: 600 }, { width: 700, height: 800 }];
  for (const [index, name] of Object.keys(entries).sort().entries()) {
    await validatePdfWithPdfJs(entries[name], {
      expectedPageCount: 1,
      expectedSizes: [zipSizes[index]],
    });
  }

  await page.getByLabel("Split mode").selectOption("groups");
  await page.getByLabel("Pages per file").fill("2");
  await page.getByRole("button", { name: "Split into groups" }).click();
  await expect(page.locator(".pdf-result-list a")).toHaveCount(2, { timeout: 30000 });
  await expect(page.getByRole("link", { name: "batch-pages-1-2.pdf" })).toBeVisible();
  await expect(page.getByRole("link", { name: "batch-pages-3-3.pdf" })).toBeVisible();

  await page.getByLabel("Split mode").selectOption("extract");
  await page.getByRole("button", { name: "Clear selection" }).click();
  await page.getByRole("button", { name: "Page 2" }).click();
  await page.getByRole("button", { name: "Extract selected pages" }).click();
  await expect(page.getByRole("link", { name: "batch-selected-pages.pdf" })).toBeVisible({ timeout: 30000 });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "batch-selected-pages.pdf" }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const extractedBytes = Buffer.concat(chunks);
  const extracted = await PDFDocument.load(extractedBytes);
  expect(extracted.getPages().map((pdfPage) => pdfPage.getSize())).toEqual([{ width: 500, height: 600 }]);
  await validatePdfWithPdfJs(new Uint8Array(extractedBytes), {
    expectedPageCount: 1,
    expectedSizes: [{ width: 500, height: 600 }],
  });
});

test("split clears stale outputs when the range changes", async ({ page }) => {
  const source = await PDFDocument.create();
  source.addPage([300, 400]); source.addPage([500, 600]);
  await page.goto("/tools/split-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "stale.pdf", mimeType: "application/pdf", buffer: Buffer.from(await source.save()) });
  await page.getByLabel("Page ranges").fill("1");
  await page.getByRole("button", { name: "Split PDF" }).click();
  await expect(page.locator(".pdf-result-list a")).toHaveCount(1, { timeout: 30000 });
  await page.getByLabel("Page ranges").fill("2");
  await expect(page.locator(".pdf-result-list a")).toHaveCount(0);
});

test("split cancellation terminates its worker without producing downloads", async ({ page }) => {
  await page.addInitScript(() => {
    const prototype = Worker.prototype;
    const postMessage = prototype.postMessage;
    const terminate = prototype.terminate;
    const tracked = new WeakSet<Worker>();
    Object.defineProperty(window, "__splitWorkerTerminated", { value: false, writable: true });
    Object.defineProperty(prototype, "postMessage", { value: function (this: Worker, message: unknown, transfer?: Transferable[]) {
      if (message && typeof message === "object" && "mode" in message) {
        tracked.add(this);
        (window as unknown as { __splitWorkerPosted: boolean }).__splitWorkerPosted = true;
      }
      return Reflect.apply(postMessage, this, [message, transfer]);
    } });
    prototype.terminate = function () {
      if (tracked.has(this)) (window as unknown as { __splitWorkerTerminated: boolean }).__splitWorkerTerminated = true;
      return terminate.call(this);
    };
  });
  const pdf = await PDFDocument.create();
  for (let pageIndex = 0; pageIndex < 300; pageIndex += 1) pdf.addPage([300, 400]);
  await page.goto("/tools/split-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "pages.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByLabel("Page ranges").fill(Array.from({ length: 20 }, (_, index) => `${index * 15 + 1}-${(index + 1) * 15}`).join(","));
  await page.getByRole("button", { name: "Split PDF" }).click();
  await page.waitForFunction(() => (window as unknown as { __splitWorkerPosted?: boolean }).__splitWorkerPosted === true);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".merge-error")).toContainText("Split cancelled");
  expect(await page.evaluate(() => (window as unknown as { __splitWorkerTerminated: boolean }).__splitWorkerTerminated)).toBe(true);
  await expect(page.locator(".merge-success a")).toHaveCount(0);
});

test("leaving the Split PDF route terminates its active worker", async ({ page }) => {
  await page.addInitScript(() => {
    const prototype = Worker.prototype;
    const postMessage = prototype.postMessage;
    const terminate = prototype.terminate;
    const tracked = new WeakSet<Worker>();
    Object.defineProperty(window, "__splitWorkerPosted", { value: false, writable: true });
    Object.defineProperty(window, "__splitWorkerTerminated", { value: false, writable: true });
    Object.defineProperty(prototype, "postMessage", { value: function (this: Worker, message: unknown, transfer?: Transferable[]) {
      if (message && typeof message === "object" && "mode" in message) {
        tracked.add(this);
        (window as unknown as { __splitWorkerPosted: boolean }).__splitWorkerPosted = true;
      }
      return Reflect.apply(postMessage, this, [message, transfer]);
    } });
    prototype.terminate = function () {
      if (tracked.has(this)) (window as unknown as { __splitWorkerTerminated: boolean }).__splitWorkerTerminated = true;
      return terminate.call(this);
    };
  });
  const pdf = await PDFDocument.create();
  for (let pageIndex = 0; pageIndex < 300; pageIndex += 1) pdf.addPage([300, 400]);
  await page.goto("/tools/split-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "pages.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByLabel("Page ranges").fill(Array.from({ length: 20 }, (_, index) => `${index * 15 + 1}-${(index + 1) * 15}`).join(","));
  await page.getByRole("button", { name: "Split PDF" }).click();
  await page.waitForFunction(() => (window as unknown as { __splitWorkerPosted: boolean }).__splitWorkerPosted);
  await page.getByRole("link", { name: "APOS workspace" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => (window as unknown as { __splitWorkerTerminated: boolean }).__splitWorkerTerminated)).toBe(true);
});

test("split revokes temporary output URLs when a new file is chosen", async ({ page }) => {
  await page.addInitScript(() => {
    const created: string[] = [];
    const revoked: string[] = [];
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => { const url = create(object); created.push(url); return url; };
    URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
    Object.defineProperty(window, "__splitObjectUrls", { value: { created, revoked } });
  });
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]);
  const fixture = Buffer.from(await pdf.save());
  await page.goto("/tools/split-pdf");
  const picker = page.locator('input[type="file"]');
  await picker.setInputFiles({ name: "first.pdf", mimeType: "application/pdf", buffer: fixture });
  await page.getByLabel("Page ranges").fill("1");
  await page.getByRole("button", { name: "Split PDF" }).click();
  await expect(page.locator(".merge-success a")).toHaveCount(1);
  const created = await page.evaluate(() => (window as unknown as { __splitObjectUrls: { created: string[] } }).__splitObjectUrls.created);
  await picker.setInputFiles({ name: "second.pdf", mimeType: "application/pdf", buffer: fixture });
  const revoked = await page.evaluate(() => (window as unknown as { __splitObjectUrls: { revoked: string[] } }).__splitObjectUrls.revoked);
  expect(revoked).toContain(created[0]);
  await expect(page.locator(".merge-success a")).toHaveCount(0);
  await page.getByLabel("Page ranges").fill("1");
  await page.getByRole("button", { name: "Split PDF" }).click();
  await expect(page.locator(".merge-success a")).toHaveCount(1);
  const latest = await page.evaluate(() => (window as unknown as { __splitObjectUrls: { created: string[] } }).__splitObjectUrls.created.at(-1));
  await page.getByRole("link", { name: "APOS workspace" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const revokedOnUnmount = await page.evaluate(() => (window as unknown as { __splitObjectUrls: { revoked: string[] } }).__splitObjectUrls.revoked);
  expect(revokedOnUnmount).toContain(latest);
});

test("split rejects invalid ranges without exposing output links", async ({ page }) => {
  const source = await PDFDocument.create();
  source.addPage([300, 400]);
  await page.goto("/tools/split-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from(await source.save()) });
  await page.getByLabel("Page ranges").fill("2");
  await expect(page.locator(".merge-error")).toContainText("outside this document");
  await expect(page.getByRole("button", { name: "Split PDF" })).toBeDisabled();
  await expect(page.locator(".merge-success a")).toHaveCount(0);
});

test("split rejects empty and corrupt PDF inputs without downloads", async ({ page }) => {
  await page.goto("/tools/split-pdf");
  const picker = page.locator('input[type="file"]');
  await picker.setInputFiles({ name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) });
  await expect(page.locator(".merge-error")).toContainText("empty");
  const corrupt = Buffer.from("%PDF-1.7 this is not a parseable PDF");
  await picker.setInputFiles({ name: "corrupt.pdf", mimeType: "application/pdf", buffer: corrupt });
  await expect(page.locator(".merge-error")).toContainText("could not be opened");
  await expect(page.locator(".merge-success a")).toHaveCount(0);
});

test("rotate preserves page order and downloads the selected rotation", async ({ page }) => {
  const source = await PDFDocument.create();
  source.addPage([300, 400]); source.addPage([500, 600]);
  const fixture = Buffer.from(await source.save());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/rotate-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "diagram.pdf", mimeType: "application/pdf", buffer: fixture });
  await page.getByLabel("Rotation").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Page 2" }).click();
  await page.getByLabel("Rotation").selectOption("270");
  await page.getByRole("button", { name: "Rotate selected pages" }).click();
  await expect(page.getByRole("button", { name: /Page 2, 270 degrees/ })).toBeVisible();
  const a11y = await new AxeBuilder({ page }).analyze();
  expect(a11y.violations).toEqual([]);
  await page.getByRole("button", { name: "Create rotated PDF" }).click();
  await expect(page.getByRole("link", { name: "diagram-rotated.pdf" })).toBeVisible({ timeout: 30000 });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "diagram-rotated.pdf" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("diagram-rotated.pdf");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const downloadedBytes = Buffer.concat(chunks);
  const output = await PDFDocument.load(downloadedBytes);
  expect(output.getPages().map((pdfPage) => pdfPage.getRotation().angle)).toEqual([0, 270]);
  expect(output.getPages().map((pdfPage) => pdfPage.getSize())).toEqual([{ width: 300, height: 400 }, { width: 500, height: 600 }]);
  await validatePdfWithPdfJs(new Uint8Array(downloadedBytes), {
    expectedPageCount: 2,
    expectedRotations: { 1: 0, 2: 270 },
    expectedSizes: [{ width: 300, height: 400 }, { width: 600, height: 500 }],
  });
});

test("rotate rejects files without a PDF signature", async ({ page }) => {
  await page.goto("/tools/rotate-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a PDF") });
  await expect(page.locator(".merge-error")).toContainText("does not have a PDF signature");
  await expect(page.getByRole("button", { name: "Create rotated PDF" })).toBeDisabled();
});

test("rotate cancellation terminates its worker without a partial result", async ({ page }) => {
  await page.addInitScript(() => {
    const prototype = Worker.prototype;
    const postMessage = prototype.postMessage;
    const terminate = prototype.terminate;
    const tracked = new WeakSet<Worker>();
    Object.defineProperty(window, "__rotateWorkerPosted", { value: false, writable: true });
    Object.defineProperty(window, "__rotateWorkerTerminated", { value: false, writable: true });
    Object.defineProperty(prototype, "postMessage", { value: function (this: Worker, message: unknown, transfer?: Transferable[]) {
      if (message && typeof message === "object" && "rotations" in message) {
        tracked.add(this);
        (window as unknown as { __rotateWorkerPosted: boolean }).__rotateWorkerPosted = true;
      }
      return Reflect.apply(postMessage, this, [message, transfer]);
    } });
    prototype.terminate = function () {
      if (tracked.has(this)) (window as unknown as { __rotateWorkerTerminated: boolean }).__rotateWorkerTerminated = true;
      return terminate.call(this);
    };
  });
  const pdf = await PDFDocument.create();
  for (let pageIndex = 0; pageIndex < 500; pageIndex += 1) pdf.addPage([300, 400]);
  await page.goto("/tools/rotate-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "pages.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "Rotate all pages" }).click({ timeout: 30000 });
  await page.getByRole("button", { name: "Create rotated PDF" }).click();
  await page.waitForFunction(() => (window as unknown as { __rotateWorkerPosted: boolean }).__rotateWorkerPosted);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".merge-error")).toContainText("Rotation cancelled");
  expect(await page.evaluate(() => (window as unknown as { __rotateWorkerTerminated: boolean }).__rotateWorkerTerminated)).toBe(true);
  await expect(page.getByRole("link", { name: "pages-rotated.pdf" })).toHaveCount(0);
});

test("rotate releases the generated URL when its route unmounts", async ({ page }) => {
  await page.addInitScript(() => {
    const created: string[] = [];
    const revoked: string[] = [];
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => { const url = create(object); created.push(url); return url; };
    URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
    Object.defineProperty(window, "__rotateObjectUrls", { value: { created, revoked } });
  });
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]);
  await page.goto("/tools/rotate-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "one.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "Rotate all pages" }).click({ timeout: 30000 });
  await page.getByRole("button", { name: "Create rotated PDF" }).click();
  await expect(page.getByRole("link", { name: "one-rotated.pdf" })).toBeVisible({ timeout: 30000 });
  const created = await page.evaluate(() => (window as unknown as { __rotateObjectUrls: { created: string[] } }).__rotateObjectUrls.created[0]);
  await page.getByRole("link", { name: "APOS workspace" }).click();
  await expect(page).toHaveURL(/\/$/);
  const revoked = await page.evaluate(() => (window as unknown as { __rotateObjectUrls: { revoked: string[] } }).__rotateObjectUrls.revoked);
  expect(revoked).toContain(created);
});

test("merge preserves mixed portrait, landscape, image and rotated pages", async ({ page }) => {
  const mixed = await makeMixedPdf();
  const second = await PDFDocument.create();
  const font = await second.embedFont(StandardFonts.Helvetica);
  second.addPage([250, 500]).drawText("Second document", { x: 24, y: 430, size: 14, font });
  await page.goto("/tools/merge-pdf");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "mixed.pdf", mimeType: "application/pdf", buffer: mixed },
    { name: "second.pdf", mimeType: "application/pdf", buffer: Buffer.from(await second.save()) },
  ]);
  await expect(page.locator(".pdf-summary-row")).toContainText("5 pages", { timeout: 30000 });
  await page.getByRole("button", { name: "Merge PDFs" }).click();
  const link = page.getByRole("link", { name: "merged.pdf" });
  await expect(link).toBeVisible({ timeout: 30000 });
  const event = page.waitForEvent("download");
  await link.click();
  const download = await event;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const result = await validatePdfWithPdfJs(new Uint8Array(Buffer.concat(chunks)), {
    expectedPageCount: 5,
    expectedSizes: [
      { width: 300, height: 400 },
      { width: 500, height: 300 },
      { width: 320, height: 480 },
      { width: 350, height: 600 },
      { width: 250, height: 500 },
    ],
    expectedText: { 1: ["Portrait page"], 2: ["Landscape page"], 4: ["Rotated source page"], 5: ["Second document"] },
    minImages: { 3: 1 },
  });
  expect(result.pages[3].rotation).toBe(90);
});

test("rotate accumulates an existing rotation on a landscape page", async ({ page }) => {
  await page.goto("/tools/rotate-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "mixed.pdf", mimeType: "application/pdf", buffer: await makeMixedPdf() });
  await page.getByLabel("Rotation").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: /Page 4/ }).click();
  await page.getByLabel("Rotation").selectOption("90");
  await page.getByRole("button", { name: "Rotate selected pages" }).click();
  await page.getByRole("button", { name: "Create rotated PDF" }).click();
  const link = page.getByRole("link", { name: "mixed-rotated.pdf" });
  await expect(link).toBeVisible({ timeout: 30000 });
  const event = page.waitForEvent("download");
  await link.click();
  const download = await event;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  await validatePdfWithPdfJs(new Uint8Array(Buffer.concat(chunks)), {
    expectedPageCount: 4,
    expectedRotations: { 4: 180 },
    expectedSizes: [
      { width: 300, height: 400 },
      { width: 500, height: 300 },
      { width: 320, height: 480 },
      { width: 600, height: 350 },
    ],
    expectedText: { 4: ["Rotated source page"] },
    minImages: { 3: 1 },
  });
});

test("watermark preserves mixed geometry and places text on a rotated page", async ({ page }) => {
  await page.goto("/tools/pdf-watermark");
  await page.locator('input[type="file"]').setInputFiles({ name: "mixed.pdf", mimeType: "application/pdf", buffer: await makeMixedPdf() });
  await page.getByLabel("Pages to update").waitFor({ timeout: 20000 });
  await page.getByLabel("Pages to update").fill("1,2,4");
  await page.getByLabel("Watermark text").fill("MIXED MARK");
  await page.getByLabel("Position").selectOption("bottom-left");
  await page.getByRole("button", { name: "Add watermark" }).click();
  const link = page.getByRole("link", { name: "mixed-watermarked.pdf" });
  await expect(link).toBeVisible({ timeout: 30000 });
  const bytes = await page.evaluate(async (href) => new Uint8Array(await (await fetch(href!)).arrayBuffer()), await link.getAttribute("href"));
  await validatePdfWithPdfJs(bytes, {
    expectedPageCount: 4,
    expectedRotations: { 4: 90 },
    expectedText: { 1: ["MIXED MARK"], 2: ["MIXED MARK"], 4: ["MIXED MARK"] },
    textPlacement: [
      { page: 1, text: "MIXED", horizontal: "left", vertical: "bottom" },
      { page: 4, text: "MIXED", horizontal: "left", vertical: "bottom" },
    ],
    minImages: { 3: 1 },
  });
});

test("page numbers respect mixed geometry and skip the cover", async ({ page }) => {
  await page.goto("/tools/pdf-page-numbers");
  await page.locator('input[type="file"]').setInputFiles({ name: "mixed.pdf", mimeType: "application/pdf", buffer: await makeMixedPdf() });
  await page.getByLabel("Pages to update").waitFor({ timeout: 20000 });
  await page.getByLabel("Skip first page").check();
  await page.getByLabel("Prefix").fill("N");
  await page.getByLabel("Position").selectOption("bottom-left");
  await page.getByRole("button", { name: "Add page numbers" }).click();
  const link = page.getByRole("link", { name: "mixed-numbered.pdf" });
  await expect(link).toBeVisible({ timeout: 30000 });
  const bytes = await page.evaluate(async (href) => new Uint8Array(await (await fetch(href!)).arrayBuffer()), await link.getAttribute("href"));
  const result = await validatePdfWithPdfJs(bytes, {
    expectedPageCount: 4,
    expectedRotations: { 4: 90 },
    expectedText: { 2: ["N1"], 3: ["N2"], 4: ["N3"] },
    textPlacement: [
      { page: 2, text: "N1", horizontal: "left", vertical: "bottom" },
      { page: 4, text: "N3", horizontal: "left", vertical: "bottom" },
    ],
    minImages: { 3: 1 },
  });
  expect(result.pages[0].text).not.toContain("N1");
});

test("PDF Essentials operations transmit no document contents to the server", async ({ page }) => {
  const requests: { url: string; method: string; postData: string | null }[] = [];
  page.on("request", (request) => {
    let postData: string | null = null;
    try { postData = request.postData(); } catch { postData = null; }
    requests.push({ url: request.url(), method: request.method(), postData });
  });
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([300, 400]).drawText("APOS_SECRET_DOCUMENT_TEXT_42", { x: 20, y: 300, size: 12, font });
  const fixture = Buffer.from(await pdf.save());
  const waitForLink = async (name: string) => expect(page.getByRole("link", { name })).toBeVisible({ timeout: 30000 });

  await page.goto("/tools/merge-pdf");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "secret-a.pdf", mimeType: "application/pdf", buffer: fixture },
    { name: "secret-b.pdf", mimeType: "application/pdf", buffer: fixture },
  ]);
  await page.getByRole("button", { name: "Merge PDFs" }).click();
  await waitForLink("merged.pdf");

  await page.goto("/tools/split-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "secret.pdf", mimeType: "application/pdf", buffer: fixture });
  await page.getByLabel("Page ranges").fill("1");
  await page.getByRole("button", { name: "Split PDF" }).click();
  await waitForLink("secret-pages-1-1.pdf");

  await page.goto("/tools/rotate-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "secret.pdf", mimeType: "application/pdf", buffer: fixture });
  await page.getByRole("button", { name: "Rotate all pages" }).click({ timeout: 30000 });
  await page.getByRole("button", { name: "Create rotated PDF" }).click();
  await waitForLink("secret-rotated.pdf");

  await page.goto("/tools/pdf-watermark");
  await page.locator('input[type="file"]').setInputFiles({ name: "secret.pdf", mimeType: "application/pdf", buffer: fixture });
  await page.getByLabel("Watermark text").fill("SECRET_MARK");
  await page.getByRole("button", { name: "Add watermark" }).click();
  await waitForLink("secret-watermarked.pdf");

  await page.goto("/tools/pdf-page-numbers");
  await page.locator('input[type="file"]').setInputFiles({ name: "secret.pdf", mimeType: "application/pdf", buffer: fixture });
  await page.getByRole("button", { name: "Add page numbers" }).click();
  await waitForLink("secret-numbered.pdf");

  expect(requests.filter((request) => request.url.includes("/api/"))).toEqual([]);
  expect(requests.filter((request) => request.url.includes("APOS_SECRET_DOCUMENT_TEXT_42"))).toEqual([]);
  expect(requests.filter((request) => request.postData?.includes("APOS_SECRET_DOCUMENT_TEXT_42"))).toEqual([]);
  expect(requests.filter((request) => request.postData?.includes("%PDF-"))).toEqual([]);
  expect(requests.filter((request) => request.postData?.includes("SECRET_MARK"))).toEqual([]);
  // The only external requests are static Google Fonts GETs; no external
  // request carries a document body.
  expect(requests.filter((request) => /^https?:/.test(request.url) && !request.url.startsWith("http://localhost:3000/") && request.postData)).toEqual([]);
});

test("page organization tools produce the requested real page outputs", async ({ page }) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(20000);
  await page.setViewportSize({ width: 390, height: 844 });
  const source = await PDFDocument.create();
  source.addPage([300, 400]); source.addPage([500, 600]); source.addPage([700, 800]);
  const fixture = Buffer.from(await source.save());
  const operations = [
    { route: "delete-pdf-pages", field: "Pages to delete", value: "2", widths: [300, 700] },
    { route: "organize-pages", field: "New page order", value: "3,1-2", widths: [700, 300, 500] },
    { route: "extract-pdf-pages", field: "Pages to extract", value: "2-3", widths: [500, 700] },
    { route: "duplicate-pdf-pages", field: "Pages to duplicate", value: "2", widths: [300, 500, 700, 500] },
  ];
  for (const operation of operations) {
    await page.goto(`/tools/${operation.route}`);
    await page.locator('input[type="file"]').setInputFiles({ name: "layout.pdf", mimeType: "application/pdf", buffer: fixture });
    await expect(page.getByText(/Current document: 3 page/)).toBeVisible();
    await page.getByLabel(operation.field).fill(operation.value);
    const a11y = await new AxeBuilder({ page }).analyze();
    expect(a11y.violations).toEqual([]);
    await page.getByRole("button", { name: /pages$/i }).click();
    await expect(page.getByRole("link", { name: "Download updated PDF" })).toBeVisible();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download updated PDF" }).click();
    const download = await downloadEvent;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const output = await PDFDocument.load(Buffer.concat(chunks));
    expect(output.getPages().map((pdfPage) => pdfPage.getSize().width)).toEqual(operation.widths);
  }

  await page.goto("/tools/add-blank-pdf-pages");
  await page.locator('input[type="file"]').setInputFiles({ name: "layout.pdf", mimeType: "application/pdf", buffer: fixture });
  await expect(page.getByText(/Current document: 3 page/)).toBeVisible();
  await page.getByLabel("Number of blank pages").fill("2");
  await page.getByLabel("Insert after page (0 inserts before page 1)").fill("1");
  const a11y = await new AxeBuilder({ page }).analyze();
  expect(a11y.violations).toEqual([]);
  await page.getByRole("button", { name: "Add blank pages" }).click();
  await expect(page.getByRole("link", { name: "Download updated PDF" })).toBeVisible();
  const blankDownloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download updated PDF" }).click();
  const blankDownload = await blankDownloadEvent;
  const blankStream = await blankDownload.createReadStream();
  const blankChunks: Buffer[] = [];
  for await (const chunk of blankStream!) blankChunks.push(Buffer.from(chunk));
  const output = await PDFDocument.load(Buffer.concat(blankChunks));
  expect(output.getPages().map((pdfPage) => pdfPage.getSize())).toEqual([{ width: 300, height: 400 }, { width: 300, height: 400 }, { width: 300, height: 400 }, { width: 500, height: 600 }, { width: 700, height: 800 }]);
});

test("each page organization action cancels and terminates its active worker", async ({ page }) => {
  await page.addInitScript(() => {
    const operationWorkers = new WeakSet<Worker>();
    const prototype = Worker.prototype;
    const postMessage = prototype.postMessage;
    const terminate = prototype.terminate;
    Object.defineProperty(window, "__organizeWorkerTerminated", { value: false, writable: true });
    Object.defineProperty(window, "__organizeWorkerPosted", { value: false, writable: true });
    Object.defineProperty(prototype, "postMessage", { value: function (this: Worker, message: unknown, transfer?: Transferable[]) {
      if (message && typeof message === "object" && (message as { action?: string }).action === "organize") {
        operationWorkers.add(this);
        (window as unknown as { __organizeWorkerPosted: boolean }).__organizeWorkerPosted = true;
      }
      return Reflect.apply(postMessage, this, [message, transfer]);
    } });
    prototype.terminate = function () {
      if (operationWorkers.has(this)) (window as unknown as { __organizeWorkerTerminated: boolean }).__organizeWorkerTerminated = true;
      return terminate.call(this);
    };
  });
  const source = await PDFDocument.create();
  for (let index = 0; index < 450; index += 1) source.addPage([300, 400]);
  const fixture = Buffer.from(await source.save());
  const actions = [
    { route: "delete-pdf-pages", field: "Pages to delete", value: "450", button: "Delete pages" },
    { route: "organize-pages", field: "New page order", value: "450,1-449", button: "Reorder pages" },
    { route: "extract-pdf-pages", field: "Pages to extract", value: "1-450", button: "Extract pages" },
    { route: "duplicate-pdf-pages", field: "Pages to duplicate", value: "450", button: "Duplicate pages" },
    { route: "add-blank-pdf-pages", field: "Number of blank pages", value: "1", button: "Add blank pages", after: "1" },
  ];
  for (const action of actions) {
    await page.goto(`/tools/${action.route}`);
    await page.locator('input[type="file"]').setInputFiles({ name: "large.pdf", mimeType: "application/pdf", buffer: fixture });
    // Parsing this stress fixture is intentionally heavier than normal input. Under two Playwright workers
    // the browser may take longer to finish it, so keep a bounded but realistic wait before cancellation.
    await expect(page.getByText(/Current document: 450 page/)).toBeVisible({ timeout: 15000 });
    await page.getByLabel(action.field).fill(action.value);
    if (action.after) await page.getByLabel("Insert after page (0 inserts before page 1)").fill(action.after);
    await page.getByRole("button", { name: action.button }).click();
    await page.waitForFunction(() => (window as unknown as { __organizeWorkerPosted: boolean }).__organizeWorkerPosted);
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".merge-error")).toContainText("Operation cancelled");
    expect(await page.evaluate(() => (window as unknown as { __organizeWorkerTerminated: boolean }).__organizeWorkerTerminated)).toBe(true);
    await expect(page.getByRole("link", { name: "Download updated PDF" })).toHaveCount(0);
  }
});

test("page organization output URLs are revoked when their route unmounts", async ({ page }) => {
  await page.addInitScript(() => {
    const created: string[] = [];
    const revoked: string[] = [];
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => { const url = create(object); created.push(url); return url; };
    URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
    Object.defineProperty(window, "__organizeObjectUrls", { value: { created, revoked } });
  });
  const source = await PDFDocument.create(); source.addPage([300, 400]); source.addPage([400, 500]);
  const fixture = Buffer.from(await source.save());
  const routes = ["delete-pdf-pages", "organize-pages", "extract-pdf-pages", "duplicate-pdf-pages", "add-blank-pdf-pages"];
  for (const route of routes) {
    await page.goto(`/tools/${route}`);
    await page.locator('input[type="file"]').setInputFiles({ name: "pages.pdf", mimeType: "application/pdf", buffer: fixture });
    // Other parallel workers may be parsing 450-page stress fixtures at the same time.
    await expect(page.getByText(/Current document: 2 page/)).toBeVisible({ timeout: 15000 });
    if (route === "delete-pdf-pages") await page.getByLabel("Pages to delete").fill("1");
    if (route === "organize-pages") await page.getByLabel("New page order").fill("2,1");
    if (route === "extract-pdf-pages") await page.getByLabel("Pages to extract").fill("1-2");
    if (route === "duplicate-pdf-pages") await page.getByLabel("Pages to duplicate").fill("1");
    await page.getByRole("button", { name: route === "delete-pdf-pages" ? "Delete pages" : route === "organize-pages" ? "Reorder pages" : route === "extract-pdf-pages" ? "Extract pages" : route === "duplicate-pdf-pages" ? "Duplicate pages" : "Add blank pages" }).click();
    await expect(page.getByRole("link", { name: "Download updated PDF" })).toBeVisible();
    const created = await page.evaluate(() => (window as unknown as { __organizeObjectUrls: { created: string[] } }).__organizeObjectUrls.created.at(-1));
    await page.getByRole("link", { name: "APOS workspace" }).click();
    await expect(page).toHaveURL(/\/$/);
    const revoked = await page.evaluate(() => (window as unknown as { __organizeObjectUrls: { revoked: string[] } }).__organizeObjectUrls.revoked);
    expect(revoked).toContain(created);
  }
});

test("page organization tools reject invalid operation settings without a download", async ({ page }) => {
  const source = await PDFDocument.create(); source.addPage([300, 400]); source.addPage([400, 500]);
  const fixture = Buffer.from(await source.save());
  const failures = [
    { route: "delete-pdf-pages", label: "Pages to delete", value: "1-2", button: "Delete pages", message: "At least one page must remain" },
    { route: "organize-pages", label: "New page order", value: "1", button: "Reorder pages", message: "Enter every page" },
    { route: "extract-pdf-pages", label: "Pages to extract", value: "3", button: "Extract pages", message: "outside this document" },
    { route: "duplicate-pdf-pages", label: "Pages to duplicate", value: "3", button: "Duplicate pages", message: "outside this document" },
  ];
  for (const failure of failures) {
    await page.goto(`/tools/${failure.route}`);
    await page.locator('input[type="file"]').setInputFiles({ name: "pages.pdf", mimeType: "application/pdf", buffer: fixture });
    await expect(page.getByText(/Current document: 2 page/)).toBeVisible();
    await page.getByLabel(failure.label).fill(failure.value);
    await page.getByRole("button", { name: failure.button }).click();
    await expect(page.locator(".merge-error")).toContainText(failure.message);
    await expect(page.getByRole("link", { name: "Download updated PDF" })).toHaveCount(0);
  }
  await page.goto("/tools/add-blank-pdf-pages");
  await page.locator('input[type="file"]').setInputFiles({ name: "pages.pdf", mimeType: "application/pdf", buffer: fixture });
  await expect(page.getByText(/Current document: 2 page/)).toBeVisible();
  await page.getByLabel("Number of blank pages").fill("21");
  await page.getByRole("button", { name: "Add blank pages" }).click();
  await expect(page.locator(".merge-error")).toContainText("between 1 and 20");
  await expect(page.getByRole("link", { name: "Download updated PDF" })).toHaveCount(0);
});

test("compress rewrites a mixed PDF and downloads the measured validated output", async ({ page }) => {
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=", "base64"));
  const image = await source.embedPng(png);
  for (let index = 0; index < 5; index += 1) {
    const page = source.addPage([400, 500]);
    page.drawText(`Mixed content page ${index + 1}`, { x: 30, y: 450, font, size: 16 });
    page.drawImage(image, { x: 30, y: 100, width: 200, height: 200 });
  }
  const fixture = Buffer.from(await source.save({ useObjectStreams: false }));
  await page.goto("/tools/compress-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "mixed-report.pdf", mimeType: "application/pdf", buffer: fixture });
  await page.getByRole("button", { name: "Compress PDF" }).click();
  await expect(page.getByRole("link", { name: "Download rewritten PDF" })).toBeVisible();
  await expect(page.locator(".merge-success p").nth(1)).toContainText("Input:");
  await expect(page.locator(".merge-success p").nth(1)).toContainText("Output:");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download rewritten PDF" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("mixed-report-compressed.pdf");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const resultBytes = Buffer.concat(chunks);
  const output = await PDFDocument.load(resultBytes);
  expect(output.getPages().map((pdfPage) => pdfPage.getSize())).toEqual(Array.from({ length: 5 }, () => ({ width: 400, height: 500 })));
  const report = await page.locator(".merge-success p").first().innerText();
  if (resultBytes.byteLength < fixture.byteLength) expect(report).toContain("Reduced by");
  else expect(report).toContain("No size reduction");
});

test("compress cancellation terminates its worker and exposes no partial result", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    Object.defineProperty(window, "__compressWorkerPosted", { value: false, writable: true });
    Object.defineProperty(window, "__compressWorkerTerminated", { value: false, writable: true });
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
        if (message && typeof message === "object" && "file" in message) {
          (window as unknown as { __compressWorkerPosted: boolean }).__compressWorkerPosted = true;
        }
        return super.postMessage(message, transfer as Transferable[]);
      }
      terminate() {
        (window as unknown as { __compressWorkerTerminated: boolean }).__compressWorkerTerminated = true;
        return super.terminate();
      }
    } as typeof Worker;
  });
  const source = await PDFDocument.create();
  for (let index = 0; index < 500; index += 1) source.addPage([300, 400]);
  await page.goto("/tools/compress-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "many-pages.pdf", mimeType: "application/pdf", buffer: Buffer.from(await source.save()) });
  await page.getByLabel("Compression method").selectOption("structure");
  await page.getByRole("button", { name: "Compress PDF" }).click();
  await page.waitForFunction(() => (window as unknown as { __compressWorkerPosted: boolean }).__compressWorkerPosted);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".merge-error")).toContainText("Compression cancelled");
  expect(await page.evaluate(() => (window as unknown as { __compressWorkerTerminated: boolean }).__compressWorkerTerminated)).toBe(true);
  await expect(page.getByRole("link", { name: "Download rewritten PDF" })).toHaveCount(0);
});

test("compress revokes output URLs when its route unmounts", async ({ page }) => {
  await page.addInitScript(() => {
    const created: string[] = [];
    const revoked: string[] = [];
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => { const url = create(object); created.push(url); return url; };
    URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
    Object.defineProperty(window, "__compressUrls", { value: { created, revoked } });
  });
  const source = await PDFDocument.create(); source.addPage([300, 400]);
  await page.goto("/tools/compress-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "one.pdf", mimeType: "application/pdf", buffer: Buffer.from(await source.save()) });
  await page.getByRole("button", { name: "Compress PDF" }).click();
  await expect(page.getByRole("link", { name: "Download rewritten PDF" })).toBeVisible();
  const created = await page.evaluate(() => (window as unknown as { __compressUrls: { created: string[] } }).__compressUrls.created[0]);
  await page.getByRole("link", { name: "APOS workspace" }).click();
  await expect(page).toHaveURL(/\/$/);
  const revoked = await page.evaluate(() => (window as unknown as { __compressUrls: { revoked: string[] } }).__compressUrls.revoked);
  expect(revoked).toContain(created);
});

test("compress rejects corrupt PDF structures without exposing a result", async ({ page }) => {
  await page.goto("/tools/compress-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 malformed structure") });
  await page.getByRole("button", { name: "Compress PDF" }).click();
  await expect(page.locator(".merge-error")).toContainText("Unable to read the selected file");
  await expect(page.getByRole("link", { name: "Download rewritten PDF" })).toHaveCount(0);
});

test("PDF to images renders validated PNG pages and creates a real ZIP download", async ({ page }) => {
  const source = await PDFDocument.create();
  const first = source.addPage([200, 300]); first.drawText("First page");
  const second = source.addPage([300, 200]); second.drawText("Second page");
  const bytes = await source.save();
  await page.goto("/tools/pdf-to-images");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "render.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) });
  await page.getByLabel("Pages to export").fill("2, 1");
  await page.getByRole("button", { name: "Convert to images" }).click();
  await expect(page.getByText(/Validated 2 image\(s\)/)).toBeVisible({ timeout: 20000 });
  const imageLinks = page.locator(".merge-success li a");
  await expect(imageLinks).toHaveCount(2);
  const firstDownload = page.waitForEvent("download");
  await imageLinks.nth(0).click();
  const image = await firstDownload;
  const imagePath = await image.path();
  expect(imagePath).toBeTruthy();
  const imageBytes = await import("node:fs/promises").then(({ readFile }) => readFile(imagePath!));
  expect([...imageBytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await page.getByRole("button", { name: "Download all as ZIP" }).click();
  await expect(page.getByRole("link", { name: "Download ZIP archive" })).toBeVisible({ timeout: 20000 });
  const zipDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download ZIP archive" }).click();
  const archive = await zipDownload;
  const archivePath = await archive.path();
  expect(archivePath).toBeTruthy();
  const zipBytes = await import("node:fs/promises").then(({ readFile }) => readFile(archivePath!));
  expect(zipBytes.subarray(0, 4).toString("hex")).toBe("504b0304");
  const archiveEntries = unzipSync(new Uint8Array(zipBytes));
  expect(Object.keys(archiveEntries)).toEqual(["render-page-0002.png", "render-page-0001.png"]);
  expect(archiveEntries["render-page-0002.png"].subarray(0, 8)).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("PDF to images cancellation stops rendering without exposing partial images", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    const original = Worker.prototype.terminate;
    Object.defineProperty(window, "__pdfWorkerStarts", { value: 0, writable: true });
    Object.defineProperty(window, "__pdfWorkerTerminations", { value: 0, writable: true });
    window.Worker = class extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        (window as unknown as { __pdfWorkerStarts: number }).__pdfWorkerStarts += 1;
      }
    } as typeof Worker;
    Worker.prototype.terminate = function () { (window as unknown as { __pdfWorkerTerminations: number }).__pdfWorkerTerminations += 1; return original.call(this); };
  });
  const source = await PDFDocument.create();
  for (let index = 0; index < 30; index += 1) source.addPage([500, 700]).drawText(`Page ${index + 1}`);
  const bytes = await source.save();
  await page.goto("/tools/pdf-to-images");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "many.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) });
  await page.getByLabel("Pages to export").fill("1-20");
  await page.getByRole("button", { name: "Convert to images" }).click();
  // Cancel once PDF.js has started its real worker. Waiting for a full page render
  // made this cancellation check depend on CPU speed during parallel browser runs.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pdfWorkerStarts: number }).__pdfWorkerStarts), { timeout: 30000 }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".merge-error")).toContainText("cancelled");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pdfWorkerTerminations: number }).__pdfWorkerTerminations)).toBeGreaterThan(0);
  await expect(page.locator(".merge-success li a")).toHaveCount(0);
});

test("PDF to images exports selected pages as JPG at the chosen resolution", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const source = await PDFDocument.create(); source.addPage([200, 300]); source.addPage([300, 200]);
  await page.goto("/tools/pdf-to-images");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "jpg.pdf", mimeType: "application/pdf", buffer: Buffer.from(await source.save()) });
  await page.getByLabel("Pages to export").fill("2, 1");
  await page.getByLabel("Image format").selectOption("jpeg");
  await page.getByLabel("Resolution").selectOption("1.5");
  await page.getByLabel("JPG quality").selectOption("0.7");
  await page.getByRole("button", { name: "Convert to images" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Validated 2 image/)).toBeVisible({ timeout: 20000 });
  const links = page.locator(".merge-success li a"); await expect(links).toHaveCount(2);
  expect(await links.nth(0).getAttribute("download")).toBe("jpg-page-0002.jpg");
  const firstBytes = await page.evaluate(async (url) => new Uint8Array(await (await fetch(url!)).arrayBuffer()), await links.nth(0).getAttribute("href"));
  expect([...firstBytes.subarray(0, 3)]).toEqual([255, 216, 255]);
  const firstSize = await page.evaluate(async (url) => { const bitmap = await createImageBitmap(await (await fetch(url!)).blob()); const dimensions = [bitmap.width, bitmap.height]; bitmap.close(); return dimensions; }, await links.nth(0).getAttribute("href"));
  expect(firstSize).toEqual([450, 300]);
  expect(await links.nth(1).getAttribute("download")).toBe("jpg-page-0001.jpg");
  const axe = await new AxeBuilder({ page }).analyze(); expect(axe.violations).toEqual([]);
});

test("PDF to images rejects invalid, corrupt and out-of-range selections", async ({ page }) => {
  await page.goto("/tools/pdf-to-images");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "invalid.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a PDF") });
  await expect(page.locator(".merge-error")).toContainText("PDF signature");
  const corrupt = Buffer.from("%PDF-1.7 corrupt");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "corrupt.pdf", mimeType: "application/pdf", buffer: corrupt });
  await page.getByRole("button", { name: "Convert to images" }).click();
  await expect(page.locator(".merge-error")).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".merge-success a")).toHaveCount(0);
  const source = await PDFDocument.create(); source.addPage([200, 300]);
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "range.pdf", mimeType: "application/pdf", buffer: Buffer.from(await source.save()) });
  await page.getByLabel("Pages to export").fill("2");
  await page.getByRole("button", { name: "Convert to images" }).click();
  await expect(page.locator(".merge-error")).toContainText("outside this document");
  const large = await PDFDocument.create();
  for (let index = 0; index < 501; index += 1) large.addPage([10, 10]);
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "over-page-limit.pdf", mimeType: "application/pdf", buffer: Buffer.from(await large.save()) });
  await page.getByRole("button", { name: "Convert to images" }).click();
  await expect(page.locator(".merge-error")).toContainText("1-500 pages", { timeout: 20000 });
});

test("PDF to images revokes generated image URLs on route unmount", async ({ page }) => {
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => { const revoked = JSON.parse(sessionStorage.getItem("apos-revoked-image-urls") ?? "[]") as string[]; revoked.push(url); sessionStorage.setItem("apos-revoked-image-urls", JSON.stringify(revoked)); original(url); };
  });
  const source = await PDFDocument.create(); source.addPage([200, 300]);
  await page.goto("/tools/pdf-to-images");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "cleanup.pdf", mimeType: "application/pdf", buffer: Buffer.from(await source.save()) });
  await page.getByRole("button", { name: "Convert to images" }).click();
  await expect(page.getByText(/Validated 1 image/)).toBeVisible({ timeout: 20000 });
  const blobUrl = await page.locator(".merge-success li a").getAttribute("href");
  await page.getByRole("link", { name: /PDF Conversion/ }).click();
  await expect(page).toHaveURL(/\/studios\/pdf-conversion/);
  const revoked = await page.evaluate(() => JSON.parse(sessionStorage.getItem("apos-revoked-image-urls") ?? "[]") as string[]);
  expect(blobUrl).toBeTruthy(); expect(revoked).toContain(blobUrl);
});

test("Images to PDF preserves selected image order in a validated downloadable PDF", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/images-to-pdf");
  const images = await page.evaluate(() => {
    const landscape = document.createElement("canvas"); landscape.width = 2; landscape.height = 1;
    const portrait = document.createElement("canvas"); portrait.width = 1; portrait.height = 2;
    return [landscape.toDataURL("image/png").split(",")[1], portrait.toDataURL("image/jpeg", 0.9).split(",")[1]];
  });
  await page.getByLabel("Choose JPG or PNG images").setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: Buffer.from(images[0], "base64") },
    { name: "two.jpg", mimeType: "image/jpeg", buffer: Buffer.from(images[1], "base64") }
  ]);
  await expect(page.getByText("one.png", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Move up two.jpg" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Create PDF" }).click();
  const downloadLink = page.getByRole("link", { name: /Download validated PDF/ });
  await expect(downloadLink).toBeVisible({ timeout: 20000 });
  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const downloaded = await import("node:fs/promises").then(({ readFile }) => readFile(path!));
  const checked = await PDFDocument.load(downloaded);
  expect(checked.getPageCount()).toBe(2);
  expect(checked.getPage(0).getHeight()).toBeGreaterThan(checked.getPage(0).getWidth());
  expect(checked.getPage(0).extractContents().filter((asset) => asset.kind === "image")).toHaveLength(1);
  expect(checked.getPage(1).extractContents().filter((asset) => asset.kind === "image")).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByLabel("Page size").selectOption("letter");
  await page.getByLabel("Orientation").selectOption("landscape");
  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(downloadLink).toBeVisible({ timeout: 20000 });
  const secondPdf = await page.evaluate(async (url) => new Uint8Array(await (await fetch(url!)).arrayBuffer()), await downloadLink.getAttribute("href"));
  const landscape = await PDFDocument.load(secondPdf);
  expect(landscape.getPage(0).getWidth()).toBeGreaterThan(landscape.getPage(0).getHeight());
  await page.getByLabel("Page size").selectOption("image");
  await page.getByRole("button", { name: "Create PDF" }).click(); await expect(downloadLink).toBeVisible({ timeout: 20000 });
  const naturalBytes = await page.evaluate(async (href) => new Uint8Array(await (await fetch(href!)).arrayBuffer()), await downloadLink.getAttribute("href"));
  const natural = await PDFDocument.load(naturalBytes);
  expect(natural.getPage(0).getWidth()).toBe(1); expect(natural.getPage(0).getHeight()).toBe(2);
});

test("Images to PDF cancellation terminates its worker and invalid images are rejected", async ({ page }) => {
  await page.addInitScript(() => {
    const tracked = new WeakSet<Worker>(); const originalPost = Worker.prototype.postMessage; const originalTerminate = Worker.prototype.terminate;
    Object.defineProperty(window, "__imagePdfLifecycle", { value: { posted: false, terminated: false } });
    Object.defineProperty(Worker.prototype, "postMessage", { value: function (...args: unknown[]) {
      const [message] = args;
      if (message && typeof message === "object" && "orientation" in message) { tracked.add(this); (window as unknown as { __imagePdfLifecycle: { posted: boolean } }).__imagePdfLifecycle.posted = true; }
      return Reflect.apply(originalPost, this, args);
    } });
    Worker.prototype.terminate = function () { if (tracked.has(this)) (window as unknown as { __imagePdfLifecycle: { terminated: boolean } }).__imagePdfLifecycle.terminated = true; return originalTerminate.call(this); };
  });
  await page.goto("/tools/images-to-pdf");
  await page.getByLabel("Choose JPG or PNG images").setInputFiles({ name: "bad.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await expect(page.locator(".merge-error")).toContainText("not a supported");
  const malformed = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("malformed")]);
  await page.getByLabel("Choose JPG or PNG images").setInputFiles({ name: "corrupt.png", mimeType: "image/png", buffer: malformed });
  await expect(page.locator(".merge-error")).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".merge-error")).toContainText("could not be decoded");
  await expect(page.getByRole("link", { name: /Download validated PDF/ })).toHaveCount(0);
  const png = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 1000; canvas.height = 1000; return canvas.toDataURL("image/png").split(",")[1]; });
  await page.getByLabel("Choose JPG or PNG images").setInputFiles({ name: "good.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.getByRole("button", { name: "Create PDF" }).click();
  await page.waitForFunction(() => (window as unknown as { __imagePdfLifecycle: { posted: boolean } }).__imagePdfLifecycle.posted);
  await page.getByRole("button", { name: "Cancel" }).click();
  const stopped = await page.evaluate(() => (window as unknown as { __imagePdfLifecycle: { terminated: boolean } }).__imagePdfLifecycle.terminated);
  expect(stopped).toBe(true);
  await expect(page.getByRole("link", { name: /Download validated PDF/ })).toHaveCount(0);
});

test("Images to PDF revokes its generated document URL when leaving the tool", async ({ page }) => {
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => { const values = JSON.parse(sessionStorage.getItem("apos-revoked-pdf-urls") ?? "[]") as string[]; values.push(url); sessionStorage.setItem("apos-revoked-pdf-urls", JSON.stringify(values)); original(url); };
  });
  await page.goto("/tools/images-to-pdf");
  const png = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 3; return canvas.toDataURL("image/png").split(",")[1]; });
  await page.getByLabel("Choose JPG or PNG images").setInputFiles({ name: "cleanup.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.getByRole("link", { name: /Download validated PDF/ })).toBeVisible({ timeout: 20000 });
  const blobUrl = await page.getByRole("link", { name: /Download validated PDF/ }).getAttribute("href");
  await page.getByRole("link", { name: /PDF Conversion/ }).click();
  await expect(page).toHaveURL(/\/studios\/pdf-conversion/);
  const revoked = await page.evaluate(() => JSON.parse(sessionStorage.getItem("apos-revoked-pdf-urls") ?? "[]") as string[]);
  expect(revoked).toContain(blobUrl);
});

test("PDF watermark applies selected text and image marks with real validated output", async ({ page }) => {
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => { const values = JSON.parse(sessionStorage.getItem("apos-revoked-watermark-urls") ?? "[]") as string[]; values.push(url); sessionStorage.setItem("apos-revoked-watermark-urls", JSON.stringify(values)); original(url); };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]); pdf.addPage([500, 600]);
  await page.goto("/tools/pdf-watermark");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "mark.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByLabel("Pages to update").waitFor({ timeout: 20000 });
  await page.getByLabel("Pages to update").fill("2");
  await page.getByLabel("Watermark text").fill("CONFIDENTIAL");
  await page.getByLabel("Position").selectOption("top-right");
  await page.getByLabel("Rotation (degrees)").fill("45");
  await page.getByLabel("Opacity").fill("0.4");
  await page.getByLabel("Font size").fill("24");
  await expect(page.locator(".pdf-page-preview img")).toBeVisible({ timeout: 20000 });
  await expect(page.getByLabel("Text color")).toBeVisible();
  await expect(page.getByLabel("Horizontal alignment")).toBeVisible();
  await expect(page.getByLabel("Vertical alignment")).toBeVisible();
  await expect(page.getByLabel("Scale (% of page width)")).toBeVisible();
  await page.getByRole("button", { name: "Add watermark" }).focus(); await page.keyboard.press("Enter");
  const link = page.getByRole("link", { name: "mark-watermarked.pdf" }); await expect(link).toBeVisible({ timeout: 20000 });
  const bytes = await page.evaluate(async (href) => new Uint8Array(await (await fetch(href!)).arrayBuffer()), await link.getAttribute("href"));
  const checked = await PDFDocument.load(bytes);
  expect(checked.getPageCount()).toBe(2);
  expect(checked.getPage(0).extractContents().filter((asset) => asset.kind === "text")).toHaveLength(0);
  expect(checked.getPage(1).extractContents().some((asset) => asset.kind === "text" && asset.getText().includes("CONFIDENTIAL"))).toBe(true);
  await validatePdfWithPdfJs(bytes, {
    expectedPageCount: 2,
    expectedText: { 2: ["CONFIDENTIAL"] },
    textPlacement: [{ page: 2, text: "CONFIDENTIAL", horizontal: "right", vertical: "top" }],
  });
  const axe = await new AxeBuilder({ page }).analyze(); expect(axe.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const png = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 8; canvas.height = 4; return canvas.toDataURL("image/png").split(",")[1]; });
  await page.getByLabel("Image watermark").check();
  await page.getByLabel("PNG or JPEG watermark image").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.getByRole("button", { name: "Add watermark" }).click(); await expect(link).toBeVisible({ timeout: 20000 });
  const imageBytes = await page.evaluate(async (href) => new Uint8Array(await (await fetch(href!)).arrayBuffer()), await link.getAttribute("href"));
  const imageMarked = await PDFDocument.load(imageBytes);
  const imageAsset = imageMarked.getPage(1).extractContents().find((asset) => asset.kind === "image");
  expect(imageAsset?.kind).toBe("image");
  if (imageAsset?.kind === "image") expect(imageAsset.drawWidth / imageAsset.drawHeight).toBeCloseTo(2, 1);
  await validatePdfWithPdfJs(imageBytes, { expectedPageCount: 2, minImages: { 2: 1 } });
  const finalUrl = await link.getAttribute("href");
  await page.getByRole("link", { name: /PDF Essentials/ }).click(); await expect(page).toHaveURL(/\/studios\/pdf-essentials/);
  const revoked = await page.evaluate(() => JSON.parse(sessionStorage.getItem("apos-revoked-watermark-urls") ?? "[]") as string[]);
  expect(revoked).toContain(finalUrl);
});

test("PDF page numbering honors start, selected pages, template, placement and download", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]); pdf.addPage([500, 600]); pdf.addPage([700, 800]);
  await page.goto("/tools/pdf-page-numbers");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "pages.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByLabel("Pages to update").waitFor({ timeout: 20000 });
  await page.getByLabel("Pages to update").fill("2-3");
  await page.getByLabel("Starting number").fill("7");
  await page.getByLabel("Prefix").fill("Sheet ");
  await page.getByLabel("Alignment").selectOption("right");
  await expect(page.getByLabel("Position")).toHaveValue("bottom-right");
  await page.getByLabel("Position").selectOption("bottom-left");
  await expect(page.locator(".pdf-page-preview img")).toBeVisible({ timeout: 20000 });
  await expect(page.getByLabel("Text color")).toBeVisible();
  await page.getByRole("button", { name: "Add page numbers" }).focus(); await page.keyboard.press("Enter");
  const link = page.getByRole("link", { name: "pages-numbered.pdf" }); await expect(link).toBeVisible({ timeout: 20000 });
  const bytes = await page.evaluate(async (href) => new Uint8Array(await (await fetch(href!)).arrayBuffer()), await link.getAttribute("href"));
  const checked = await PDFDocument.load(bytes); const text = (index: number) => checked.getPage(index).extractContents().filter((asset) => asset.kind === "text").map((asset) => asset.kind === "text" ? asset.getText() : "").join(" ");
  expect(text(0)).toBe(""); expect(text(1)).toContain("Sheet 7"); expect(text(2)).toContain("Sheet 8");
  await validatePdfWithPdfJs(bytes, {
    expectedPageCount: 3,
    expectedText: { 2: ["Sheet 7"], 3: ["Sheet 8"] },
    textPlacement: [{ page: 2, text: "Sheet", horizontal: "left", vertical: "bottom" }],
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).analyze(); expect(axe.violations).toEqual([]);
});

test("PDF page numbering supports skip-cover and padded formatting", async ({ page }) => {
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]); pdf.addPage([500, 600]); pdf.addPage([700, 800]);
  await page.goto("/tools/pdf-page-numbers");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "padded.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByLabel("Pages to update").waitFor({ timeout: 20000 });
  await page.getByLabel("Skip first page").check();
  await page.getByLabel("Numbering format").selectOption("padded");
  await page.getByLabel("Prefix").fill("Page ");
  await page.getByRole("button", { name: "Add page numbers" }).click();
  const link = page.getByRole("link", { name: "padded-numbered.pdf" });
  await expect(link).toBeVisible({ timeout: 20000 });
  const bytes = await page.evaluate(async (href) => new Uint8Array(await (await fetch(href!)).arrayBuffer()), await link.getAttribute("href"));
  const checked = await PDFDocument.load(bytes);
  const text = (index: number) => checked.getPage(index).extractContents().filter((asset) => asset.kind === "text").map((asset) => asset.kind === "text" ? asset.getText() : "").join(" ");
  expect(text(0)).toBe("");
  expect(text(1)).toContain("Page 01");
  expect(text(2)).toContain("Page 02");
  await validatePdfWithPdfJs(bytes, {
    expectedPageCount: 3,
    expectedText: { 2: ["Page 01"], 3: ["Page 02"] },
  });
});

test("PDF Essentials tools render without dark-theme accessibility or overflow regressions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]);
  const fixture = Buffer.from(await pdf.save());
  for (const route of ["merge-pdf", "split-pdf", "rotate-pdf", "pdf-watermark", "pdf-page-numbers"]) {
    await page.goto(`/tools/${route}`);
    await page.locator('input[type="file"]').setInputFiles({ name: `${route}.pdf`, mimeType: "application/pdf", buffer: fixture });
    if (route === "merge-pdf") await expect(page.locator(".pdf-merge-copy")).toContainText("1 page", { timeout: 20000 });
    else await expect(page.locator(".pdf-file-summary")).toContainText("1 page", { timeout: 20000 });
    if (await page.locator("html").getAttribute("data-theme") !== "dark") {
      await page.getByRole("button", { name: "Switch to dark theme" }).click();
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  }
  await page.getByRole("button", { name: "Switch to light theme" }).click();
});

test("PDF Essentials tools render at desktop dimensions without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]);
  const fixture = Buffer.from(await pdf.save());
  for (const route of ["merge-pdf", "split-pdf", "rotate-pdf", "pdf-watermark", "pdf-page-numbers"]) {
    await page.goto(`/tools/${route}`);
    await page.locator('input[type="file"]').setInputFiles({ name: `${route}.pdf`, mimeType: "application/pdf", buffer: fixture });
    if (route === "merge-pdf") await expect(page.locator(".pdf-merge-copy")).toContainText("1 page", { timeout: 20000 });
    else await expect(page.locator(".pdf-file-summary")).toContainText("1 page", { timeout: 20000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  }
});

test("PDF watermark worker cancellation terminates processing and exposes no partial result", async ({ page }) => {
  await page.addInitScript(() => {
    const tracked = new WeakSet<Worker>(); const post = Worker.prototype.postMessage; const terminate = Worker.prototype.terminate;
    Object.defineProperty(window, "__markLifecycle", { value: { posted: false, terminated: false } });
    Object.defineProperty(Worker.prototype, "postMessage", { value: function (...args: unknown[]) { const [message] = args; if (message && typeof message === "object" && "options" in message) { tracked.add(this); (window as unknown as { __markLifecycle: { posted: boolean } }).__markLifecycle.posted = true; } return Reflect.apply(post, this, args); } });
    Worker.prototype.terminate = function () { if (tracked.has(this)) (window as unknown as { __markLifecycle: { terminated: boolean } }).__markLifecycle.terminated = true; return terminate.call(this); };
  });
  const pdf = await PDFDocument.create(); for (let index = 0; index < 450; index += 1) pdf.addPage([300, 400]);
  await page.goto("/tools/pdf-watermark");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "cancel.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByLabel("Watermark text").fill("Draft"); await page.getByRole("button", { name: "Add watermark" }).click();
  await page.waitForFunction(() => (window as unknown as { __markLifecycle: { posted: boolean } }).__markLifecycle.posted);
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await page.evaluate(() => (window as unknown as { __markLifecycle: { terminated: boolean } }).__markLifecycle.terminated)).toBe(true);
  await expect(page.getByRole("link", { name: "cancel-watermarked.pdf" })).toHaveCount(0);
});

test("PDF page numbering worker cancellation terminates processing and exposes no partial result", async ({ page }) => {
  await page.addInitScript(() => {
    const tracked = new WeakSet<Worker>(); const post = Worker.prototype.postMessage; const terminate = Worker.prototype.terminate;
    Object.defineProperty(window, "__pageNumberLifecycle", { value: { posted: false, terminated: false } });
    Object.defineProperty(Worker.prototype, "postMessage", { value: function (...args: unknown[]) {
      const [message] = args;
      if (message && typeof message === "object" && "options" in message) {
        tracked.add(this);
        (window as unknown as { __pageNumberLifecycle: { posted: boolean } }).__pageNumberLifecycle.posted = true;
      }
      return Reflect.apply(post, this, args);
    } });
    Worker.prototype.terminate = function () {
      if (tracked.has(this)) (window as unknown as { __pageNumberLifecycle: { terminated: boolean } }).__pageNumberLifecycle.terminated = true;
      return terminate.call(this);
    };
  });
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 450; index += 1) pdf.addPage([300, 400]);
  await page.goto("/tools/pdf-page-numbers");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "cancel-numbering.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "Add page numbers" }).click();
  await page.waitForFunction(() => (window as unknown as { __pageNumberLifecycle: { posted: boolean } }).__pageNumberLifecycle.posted);
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await page.evaluate(() => (window as unknown as { __pageNumberLifecycle: { terminated: boolean } }).__pageNumberLifecycle.terminated)).toBe(true);
  await expect(page.getByRole("link", { name: "cancel-numbering-numbered.pdf" })).toHaveCount(0);
});

test("PDF metadata can be inspected, edited and downloaded with supported fields verified", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => { const values = JSON.parse(sessionStorage.getItem("apos-revoked-metadata-urls") ?? "[]") as string[]; values.push(url); sessionStorage.setItem("apos-revoked-metadata-urls", JSON.stringify(values)); original(url); };
  });
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]); pdf.setTitle("Original title"); pdf.setAuthor("Original author"); pdf.setKeywords(["draft", "internal"]);
  await page.goto("/tools/pdf-metadata");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "metadata.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "Inspect metadata" }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Read metadata" })).toBeVisible({ timeout: 20000 });
  await expect(page.getByLabel("Title")).toHaveValue("Original title");
  await page.getByLabel("Title").fill("Verified title"); await page.getByLabel("Author").fill("APOS user");
  await page.getByRole("button", { name: "Save metadata changes" }).focus(); await page.keyboard.press("Enter");
  const link = page.getByRole("link", { name: "Download validated PDF" }); await expect(link).toBeVisible({ timeout: 20000 });
  const downloadPromise = page.waitForEvent("download"); await link.click(); const download = await downloadPromise; const path = await download.path();
  expect(path).toBeTruthy(); const downloaded = await import("node:fs/promises").then(({ readFile }) => readFile(path!));
  const checked = await PDFDocument.load(downloaded); expect(checked.getTitle()).toBe("Verified title"); expect(checked.getAuthor()).toBe("APOS user"); expect(checked.getKeywords()).toBe("draft internal");
  const axe = await new AxeBuilder({ page }).analyze(); expect(axe.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const outputUrl = await link.getAttribute("href");
  await page.getByRole("link", { name: /Developer Studio/ }).click(); await expect(page).toHaveURL(/\/studios\/developer-studio/);
  const revoked = await page.evaluate(() => JSON.parse(sessionStorage.getItem("apos-revoked-metadata-urls") ?? "[]") as string[]);
  expect(revoked).toContain(outputUrl);
});

test("PDF metadata inspection can be cancelled and terminates its worker", async ({ page }) => {
  await page.addInitScript(() => {
    const tracked = new WeakSet<Worker>(); const post = Worker.prototype.postMessage; const terminate = Worker.prototype.terminate;
    Object.defineProperty(window, "__metadataLifecycle", { value: { posted: false, terminated: false } });
    Object.defineProperty(Worker.prototype, "postMessage", { value: function (...args: unknown[]) { const [message] = args; if (message && typeof message === "object" && (message as { action?: string }).action === "inspect") { tracked.add(this); (window as unknown as { __metadataLifecycle: { posted: boolean } }).__metadataLifecycle.posted = true; } return Reflect.apply(post, this, args); } });
    Worker.prototype.terminate = function () { if (tracked.has(this)) (window as unknown as { __metadataLifecycle: { terminated: boolean } }).__metadataLifecycle.terminated = true; return terminate.call(this); };
  });
  const pdf = await PDFDocument.create(); for (let index = 0; index < 450; index += 1) pdf.addPage([300, 400]);
  await page.goto("/tools/pdf-metadata"); await page.getByLabel("Choose a PDF").setInputFiles({ name: "inspect-cancel.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "Inspect metadata" }).click();
  await page.waitForFunction(() => (window as unknown as { __metadataLifecycle: { posted: boolean } }).__metadataLifecycle.posted);
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await page.evaluate(() => (window as unknown as { __metadataLifecycle: { terminated: boolean } }).__metadataLifecycle.terminated)).toBe(true);
  await expect(page.getByRole("button", { name: "Save metadata changes" })).toHaveCount(0);
});

test("Protect PDF creates genuinely AES-256 password-gated output", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => { const values = JSON.parse(sessionStorage.getItem("apos-revoked-protected-pdf") ?? "[]") as string[]; values.push(url); sessionStorage.setItem("apos-revoked-protected-pdf", JSON.stringify(values)); original(url); };
  });
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]);
  await page.goto("/tools/protect-pdf");
  await page.getByLabel("Choose a PDF").setInputFiles({ name: "private.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByLabel("Opening password (12 characters minimum)").fill("opening-pass-123");
  await page.getByLabel("Owner password (12 characters minimum, different from opening password)").fill("owner-pass-456");
  const axe = await new AxeBuilder({ page }).analyze(); expect(axe.violations).toEqual([]);
  await page.getByRole("button", { name: "Protect PDF" }).focus(); await page.keyboard.press("Enter");
  const link = page.getByRole("link", { name: "Download password-protected PDF" }); await expect(link).toBeVisible({ timeout: 20000 });
  const downloadPromise = page.waitForEvent("download"); await link.click(); const download = await downloadPromise; const path = await download.path();
  expect(path).toBeTruthy(); const bytes = await import("node:fs/promises").then(({ readFile }) => readFile(path!));
  await expect(PDFDocument.load(bytes)).rejects.toThrow();
  await expect(PDFDocument.load(bytes, { password: "wrong-opening-pass" })).rejects.toThrow();
  expect((await PDFDocument.load(bytes, { password: "opening-pass-123" })).getPageCount()).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const blobUrl = await link.getAttribute("href");
  await page.getByRole("link", { name: /PDF Security/ }).click(); await expect(page).toHaveURL(/\/studios\/pdf-security-signature/);
  const revoked = await page.evaluate(() => JSON.parse(sessionStorage.getItem("apos-revoked-protected-pdf") ?? "[]") as string[]); expect(revoked).toContain(blobUrl);
});

test("Protect PDF cancellation terminates its worker and releases password fields", async ({ page }) => {
  await page.addInitScript(() => {
    const tracked = new WeakSet<Worker>(); const post = Worker.prototype.postMessage; const terminate = Worker.prototype.terminate;
    Object.defineProperty(window, "__protectLifecycle", { value: { posted: false, terminated: false } });
    Object.defineProperty(Worker.prototype, "postMessage", { value: function (...args: unknown[]) { const [message] = args; if (message && typeof message === "object" && "userPassword" in message) { tracked.add(this); (window as unknown as { __protectLifecycle: { posted: boolean } }).__protectLifecycle.posted = true; } return Reflect.apply(post, this, args); } });
    Worker.prototype.terminate = function () { if (tracked.has(this)) (window as unknown as { __protectLifecycle: { terminated: boolean } }).__protectLifecycle.terminated = true; return terminate.call(this); };
  });
  const pdf = await PDFDocument.create(); for (let index = 0; index < 450; index += 1) pdf.addPage([300, 400]);
  await page.goto("/tools/protect-pdf"); await page.getByLabel("Choose a PDF").setInputFiles({ name: "cancel-protect.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByLabel("Opening password (12 characters minimum)").fill("opening-pass-123");
  await page.getByLabel("Owner password (12 characters minimum, different from opening password)").fill("owner-pass-456");
  await page.getByRole("button", { name: "Protect PDF" }).click();
  await page.waitForFunction(() => (window as unknown as { __protectLifecycle: { posted: boolean } }).__protectLifecycle.posted);
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await page.evaluate(() => (window as unknown as { __protectLifecycle: { terminated: boolean } }).__protectLifecycle.terminated)).toBe(true);
  await expect(page.getByLabel("Opening password (12 characters minimum)")).toHaveValue("");
  await expect(page.getByRole("link", { name: "Download password-protected PDF" })).toHaveCount(0);
});

test("mobile navigation opens, remains labeled, and supports selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  const navigation = page.getByRole("navigation", { name: "Product studios" });
  await expect(navigation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(navigation).toBeHidden();
  await page.getByRole("button", { name: "Open menu" }).click();
  await navigation.getByRole("link", { name: "PDF Essentials" }).click();
  await expect(page.getByRole("heading", { name: "PDF Essentials" }).last()).toBeVisible();
});

test("theme preference persists across reloads", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/tools/merge-pdf");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("sidebar collapse preference persists across reloads", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => localStorage.getItem("apos-sidebar") !== null);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator(".sidebar").first()).toHaveClass(/is-collapsed/);
  await page.reload();
  await expect(page.locator(".sidebar").first()).toHaveClass(/is-collapsed/);
});

test("dashboard has no automated accessibility violations", async ({ page }) => {
  // Audit the settled page: entrance animations fade content in, and axe would
  // measure colours mid-transition. Reduced motion is the state that never animates.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const lightResults = await new AxeBuilder({ page }).analyze();
  expect(lightResults.violations).toEqual([]);
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.waitForTimeout(200);
  const darkResults = await new AxeBuilder({ page }).analyze();
  expect(darkResults.violations).toEqual([]);
});

test("Edit PDF uploads, annotates, downloads a flattened copy and retains content", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/tools/edit-pdf");
  await expect(page.getByText("Available · text editing in the browser")).toBeVisible();

  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  source.addPage([600, 800]).drawText("Original page text", { x: 50, y: 700, size: 18, font });
  const fixture = Buffer.from(await source.save());

  await page.getByLabel("Choose PDF").setInputFiles({
    name: "document.pdf",
    mimeType: "application/pdf",
    buffer: fixture,
  });
  await expect(page.getByText("document.pdf")).toBeVisible();

  const layer = page.locator('[data-testid="pdf-annotation-layer"]');
  await expect.poll(() => layer.boundingBox(), { timeout: 10000 }).toBeTruthy();

  // Add a text-box annotation by dragging on the page layer.
  await page.getByRole("button", { name: "Text box" }).click();
  await page.getByLabel("Text box content").fill("Annotated note");
  await expect(page.getByLabel("Text box content")).toHaveValue("Annotated note");
  const layerEl = await layer.elementHandle();
  expect(layerEl).toBeTruthy();
  const box = await layer.boundingBox();
  expect(box).toBeTruthy();

  await layerEl!.evaluate((el, { sx, sy, ex, ey }: { sx: number; sy: number; ex: number; ey: number }) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + sx; const cy = rect.top + sy;
    const ex2 = rect.left + ex; const ey2 = rect.top + ey;
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: "mouse" }));
    el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: ex2, clientY: ey2, pointerId: 1, pointerType: "mouse" }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: ex2, clientY: ey2, pointerId: 1, pointerType: "mouse" }));
  }, { sx: 60, sy: 100, ex: 300, ey: 260 });

  await expect(page.getByText("Text box annotation 1: Annotated note")).toBeVisible();

  // Add a rectangle annotation.
  await page.getByRole("button", { name: "Rectangle" }).click();
  const rectLayerEl = await layer.elementHandle();
  expect(rectLayerEl).toBeTruthy();
  await rectLayerEl!.evaluate((el, { sx, sy, ex, ey }: { sx: number; sy: number; ex: number; ey: number }) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + sx; const cy = rect.top + sy;
    const ex2 = rect.left + ex; const ey2 = rect.top + ey;
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: "mouse" }));
    el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: ex2, clientY: ey2, pointerId: 1, pointerType: "mouse" }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: ex2, clientY: ey2, pointerId: 1, pointerType: "mouse" }));
  }, { sx: 80, sy: 300, ex: 260, ey: 420 });

  await expect(page.getByText(/Rectangle annotation/)).toBeVisible();

  // Download the flattened edited PDF.
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download edited PDF" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("document-annotated.pdf");

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const output = await PDFDocument.load(Buffer.concat(chunks));

  expect(output.getPageCount()).toBe(1);
  const assets = output.getPage(0).extractContents();
  const texts = assets.filter((a) => a.kind === "text").map((a) => (a.kind === "text" ? a.getText() : ""));
  expect(texts.join(" ")).toContain("Original page text");
  expect(texts.join(" ")).toContain("Annotated note");
  expect(assets.filter((a) => a.kind === "graphics").length).toBeGreaterThanOrEqual(1);
});
