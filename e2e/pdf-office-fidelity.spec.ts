import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { unzipSync } from "fflate";
import { readFile } from "node:fs/promises";

async function styledPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  page.drawText("Fidelity Check", { x: 50, y: 780, size: 24, font: bold, color: rgb(0.8, 0.1, 0.1) });
  page.drawText("Blue body text at thirteen points.", { x: 50, y: 735, size: 13, font: regular, color: rgb(0.1, 0.2, 0.75) });
  page.drawText("Item", { x: 60, y: 680, size: 11, font: bold, color: rgb(0.1, 0.55, 0.2) });
  page.drawText("Amount", { x: 330, y: 680, size: 11, font: bold, color: rgb(0.1, 0.55, 0.2) });
  page.drawText("Widget", { x: 60, y: 655, size: 11, font: regular });
  page.drawText("4200", { x: 330, y: 655, size: 11, font: regular });
  page.drawText("Gadget", { x: 60, y: 630, size: 11, font: regular });
  page.drawText("1500", { x: 330, y: 630, size: 11, font: regular });
  return Buffer.from(await pdf.save());
}

async function convert(page: import("@playwright/test").Page, mode: "editable" | "positions", name: string) {
  await page.goto("/tools/pdf-to-office");
  await page.getByLabel("Choose a file").setInputFiles({ name: "fidelity.pdf", mimeType: "application/pdf", buffer: await styledPdf() });
  await expect(page.getByRole("heading", { name: "Document preview" })).toBeVisible({ timeout: 20000 });
  await expect(page.getByLabel("Word mode")).toHaveValue("editable");
  await page.getByLabel("Word mode").selectOption(mode);
  await page.getByLabel("Output filename").fill(name);
  await page.getByRole("button", { name: "Convert PDF" }).click();
  await expect(page.locator(".merge-success")).toBeVisible({ timeout: 30000 });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: `Download ${name}.docx` }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Download was not saved.");
  return new TextDecoder().decode(unzipSync(new Uint8Array(await readFile(path)))["word/document.xml"]);
}

test("PDF to Word preserves text colours, fonts, sizes and real table columns", async ({ page }) => {
  const xml = await convert(page, "editable", "fidelity-editable");

  expect(xml).toContain('w:color w:val="CC1A1A"');
  expect(xml).toContain('w:color w:val="1A33BF"');
  expect(xml).toContain('w:color w:val="1A8C33"');
  expect(xml).toContain('w:ascii="Times New Roman"');
  expect(xml).toContain('w:sz w:val="26"');
  expect((xml.match(/<w:tbl>/g) ?? []).length).toBe(1);

  const grid = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(xml)?.[1] ?? "";
  const widths = [...grid.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((match) => Number(match[1]));
  expect(widths).toHaveLength(2);
  expect(widths[0] + widths[1]).toBe(9360);
  expect(widths[0]).toBeGreaterThan(widths[1]);

  const headerRow = /<w:tr>([\s\S]*?)<\/w:tr>/.exec(xml)?.[1] ?? "";
  expect(headerRow).toContain('w:color w:val="1A8C33"');
  expect(headerRow).toContain("<w:b/>");
  expect(headerRow).toContain('w:sz w:val="22"');
});

test("Exact positions also keeps text colour, font and size", async ({ page }) => {
  const xml = await convert(page, "positions", "fidelity-positions");
  expect(xml).toContain('w:color w:val="CC1A1A"');
  expect(xml).toContain('w:color w:val="1A33BF"');
  expect(xml).toContain('w:ascii="Times New Roman"');
  expect(xml).toContain('w:sz w:val="26"');
});
