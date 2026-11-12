import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from "@cantoo/pdf-lib";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function regressionPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const image = await pdf.embedPng(PNG);

  for (let index = 1; index <= 5; index += 1) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`Heading ${index}`, { x: 50, y: 770, size: 22, font: bold, color: rgb(0.1, 0.1, 0.15) });
    page.drawText(`Paragraph on page ${index} with PAGE_MARKER_${index}.`, { x: 50, y: 730, size: 12, font });
    if (index === 1) {
      page.drawText("Region", { x: 50, y: 680, size: 11, font: bold });
      page.drawText("Revenue", { x: 250, y: 680, size: 11, font: bold });
      page.drawText("North", { x: 50, y: 660, size: 11, font });
      page.drawText("1200", { x: 250, y: 660, size: 11, font });
    }
    if (index === 3) {
      page.drawText("Page 3 content image follows.", { x: 50, y: 690, size: 12, font });
      page.drawImage(image, { x: 50, y: 520, width: 180, height: 120 });
    }
    if (index === 4) {
      page.drawText("Page 4 identity-transform image follows.", { x: 50, y: 690, size: 12, font });
      const name = page.node.newXObject("Image", image.ref);
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(1, 0, 0, 1, 0, 0),
        drawObject(name),
        popGraphicsState(),
      );
    }
  }
  return Buffer.from(await pdf.save());
}

async function hybridPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const image = await pdf.embedPng(PNG);
  for (let index = 1; index <= 2; index += 1) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`Text page ${index} with HYBRID_TEXT_${index}.`, { x: 50, y: 760, size: 14, font });
  }
  for (let index = 3; index <= 5; index += 1) {
    const page = pdf.addPage([595, 842]);
    page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  }
  return Buffer.from(await pdf.save());
}

async function convertOffice(page: import("@playwright/test").Page, pdf: Buffer, mode: "editable" | "visual" = "editable") {
  await page.goto("/tools/pdf-to-office");
  await page.getByLabel("Choose a file").setInputFiles({ name: "regression.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByRole("heading", { name: "Document preview" })).toBeVisible({ timeout: 30000 });
  if (mode === "visual") await page.getByLabel("Word mode").selectOption("visual");
  await page.getByRole("button", { name: "Convert PDF" }).click();
  await expect(page.locator(".merge-success, .merge-error").first()).toBeVisible({ timeout: 120000 });
  return page;
}

async function downloadDocx(page: import("@playwright/test").Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: /Download .*\.docx$/ }).click();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error("DOCX download was not saved.");
  const bytes = new Uint8Array(await readFile(path));
  return { bytes, entries: unzipSync(bytes), xml: new TextDecoder().decode(unzipSync(bytes)["word/document.xml"]) };
}

function imageExtents(xml: string) {
  return [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].map((match) => ({
    width: Number(match[1]) / 12700,
    height: Number(match[2]) / 12700,
  }));
}

test("Editable Word keeps every page editable and never inserts page screenshots", async ({ page }) => {
  test.setTimeout(120000);
  await convertOffice(page, await regressionPdf());
  const { xml, entries } = await downloadDocx(page);

  for (let index = 1; index <= 5; index += 1) {
    expect(xml.match(new RegExp(`PAGE_MARKER_${index}`, "g")) ?? []).toHaveLength(1);
  }
  const order = [1, 2, 3, 4, 5].map((index) => xml.indexOf(`PAGE_MARKER_${index}`));
  expect(order).toEqual([...order].sort((left, right) => left - right));
  expect(xml).toContain("Page 3 content image follows");
  expect(xml).toContain("Page 4 identity-transform image follows");
  expect(xml).toContain("<w:tbl>");
  expect(xml).toContain("North");
  expect(xml).toContain("1200");

  const media = Object.keys(entries).filter((name) => name.startsWith("word/media/"));
  expect(media.length).toBeGreaterThanOrEqual(1);
  const extents = imageExtents(xml);
  for (const extent of extents) {
    // A full-page screenshot scaled into Letter's content area is about
    // 6.5 x 9.19 inches. The real fixture image is 180 x 120 points.
    expect(extent.width).toBeLessThan(430);
    expect(extent.height).toBeLessThan(300);
  }
});

test("Editable Word preserves mixed portrait and landscape source page sizes", async ({ page }) => {
  test.setTimeout(120000);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([595, 842]).drawText("PORTRAIT_MARKER", { x: 50, y: 760, size: 16, font });
  pdf.addPage([842, 595]).drawText("LANDSCAPE_MARKER", { x: 50, y: 520, size: 16, font });
  await convertOffice(page, Buffer.from(await pdf.save()));
  const { xml } = await downloadDocx(page);
  expect(xml).toContain("PORTRAIT_MARKER");
  expect(xml).toContain("LANDSCAPE_MARKER");
  expect(xml).toContain('<w:pgSz w:w="11900" w:h="16840"');
  expect(xml).toContain('<w:pgSz w:w="16840" w:h="11900" w:orient="landscape"');
  expect((xml.match(/<w:sectPr/g) ?? []).length).toBeGreaterThanOrEqual(2);
});

test("Hybrid image-only pages fail clearly in Editable Word and do not download a screenshot document", async ({ page }) => {
  test.setTimeout(120000);
  await convertOffice(page, await hybridPdf());
  await expect(page.locator(".merge-error")).toContainText("Pages 3, 4, 5");
  await expect(page.locator(".merge-error")).toContainText("OCR");
  await expect(page.getByRole("link", { name: /Download .*\.docx$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enable OCR and retry" })).toBeVisible();
});

test("Visual Word embeds five page pictures and no reference text", async ({ page }) => {
  test.setTimeout(120000);
  await convertOffice(page, await regressionPdf(), "visual");
  const { xml, entries } = await downloadDocx(page);
  const media = Object.keys(entries).filter((name) => name.startsWith("word/media/"));
  expect(media).toHaveLength(5);
  expect(xml).not.toContain("PAGE_MARKER_1");
  expect(xml).not.toContain("Extracted text (reference)");
});

test("Universal converter uses the corrected editable Word engine", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/tools/universal-converter");
  await page.getByLabel("Your file").setInputFiles({ name: "regression.pdf", mimeType: "application/pdf", buffer: await regressionPdf() });
  await page.getByLabel("What do you want?").fill("convert to Word");
  await page.getByRole("button", { name: "Convert", exact: true }).click();
  await expect(page.locator(".merge-success, .merge-error").first()).toBeVisible({ timeout: 120000 });
  const { xml, entries } = await downloadDocx(page);
  for (let index = 1; index <= 5; index += 1) expect(xml).toContain(`PAGE_MARKER_${index}`);
  const extents = imageExtents(xml);
  for (const extent of extents) {
    expect(extent.width).toBeLessThan(430);
    expect(extent.height).toBeLessThan(300);
  }
  expect(Object.keys(entries).filter((name) => name.startsWith("word/media/")).length).toBeGreaterThanOrEqual(1);
});

test("OCR-enabled Editable Word inserts recognised text and no page screenshot", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto("/tools/pdf-to-office");
  const pngBase64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 1400;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000000";
    context.font = "bold 90px Arial";
    context.fillText("PAGE_MARKER_OCR_2", 60, 220);
    context.font = "48px Arial";
    context.fillText("This page is a scan.", 60, 340);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([595, 842]).drawText("Text page with OCR_TEXT_PAGE_1.", { x: 50, y: 760, size: 14, font });
  const image = await pdf.embedPng(Buffer.from(pngBase64, "base64"));
  pdf.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  await page.getByLabel("Choose a file").setInputFiles({ name: "ocr.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await expect(page.getByRole("heading", { name: "Document preview" })).toBeVisible({ timeout: 30000 });
  await page.getByLabel(/OCR image-only pages/).check();
  await page.getByRole("button", { name: "Convert PDF" }).click();
  await expect(page.locator(".merge-success")).toBeVisible({ timeout: 240000 });
  await expect(page.locator(".merge-success p").first()).toContainText("1 OCR page(s)");
  const { xml, entries } = await downloadDocx(page);
  expect(xml).toContain("OCR_TEXT_PAGE_1");
  expect(xml.toLowerCase()).toContain("scan");
  expect(Object.keys(entries).filter((name) => name.startsWith("word/media/"))).toHaveLength(0);
});

test("Universal converter does not bypass scan detection with the legacy screenshot path", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/tools/universal-converter");
  await page.getByLabel("Your file").setInputFiles({ name: "hybrid.pdf", mimeType: "application/pdf", buffer: await hybridPdf() });
  await page.getByLabel("What do you want?").fill("convert to Word");
  await page.getByRole("button", { name: "Convert", exact: true }).click();
  await expect(page.locator(".merge-error")).toContainText("Pages 3, 4, 5", { timeout: 120000 });
  await expect(page.getByRole("link", { name: "Open PDF to Office" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Download .*\.docx$/ })).toHaveCount(0);
});
