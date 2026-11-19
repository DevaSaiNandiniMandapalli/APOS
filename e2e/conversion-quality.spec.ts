import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { unzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { buildDocx } from "../src/lib/office-formats";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

/** A two-page report with a heading hierarchy, a table and a picture. */
async function reportPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const image = await pdf.embedPng(PNG);

  const page = pdf.addPage([595, 842]);
  page.drawText("Quarterly Operations Report", { x: 50, y: 780, size: 24, font: bold, color: rgb(0.1, 0.1, 0.15) });
  page.drawText("1. Summary", { x: 50, y: 735, size: 16, font: bold });
  page.drawText("Revenue grew by 18 percent in the third quarter.", { x: 50, y: 710, size: 11, font });
  page.drawText("2. Regional detail", { x: 50, y: 665, size: 16, font: bold });

  const rows = [
    ["Region", "Units", "Revenue"],
    ["North", "1200", "48000"],
    ["South", "940", "37600"],
    ["East", "610", "24400"],
  ];
  rows.forEach((row, index) => {
    const y = 630 - index * 22;
    page.drawText(row[0], { x: 60, y, size: 11, font: index === 0 ? bold : font });
    page.drawText(row[1], { x: 240, y, size: 11, font: index === 0 ? bold : font });
    page.drawText(row[2], { x: 380, y, size: 11, font: index === 0 ? bold : font });
  });

  page.drawText("3. Outlook", { x: 50, y: 520, size: 16, font: bold });
  page.drawText("The fourth quarter target is 3200 units.", { x: 50, y: 495, size: 11, font });
  page.drawImage(image, { x: 50, y: 400, width: 120, height: 90 });

  const page2 = pdf.addPage([595, 842]);
  page2.drawText("Appendix", { x: 50, y: 780, size: 18, font: bold });
  page2.drawText("Second page content with APPENDIX_MARKER.", { x: 50, y: 750, size: 11, font });

  return Buffer.from(await pdf.save());
}

async function pdfToWord(page: import("@playwright/test").Page, source: Buffer) {
  await page.goto("/tools/pdf-to-office");
  await page.getByLabel("Choose a file").setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: source });
  await expect(page.getByRole("heading", { name: "Document preview" })).toBeVisible({ timeout: 60000 });
  await page.getByLabel("Word mode").selectOption("editable");
  await page.getByRole("button", { name: "Convert PDF" }).click();
  await expect(page.getByRole("link", { name: /Download .*\.docx$/ })).toBeVisible({ timeout: 120000 });
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: /Download .*\.docx$/ }).click();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error("DOCX download was not saved.");
  const bytes = new Uint8Array(await readFile(path));
  const entries = unzipSync(bytes);
  return { bytes, entries, xml: new TextDecoder().decode(entries["word/document.xml"]) };
}

/** Extracts the text layer of a PDF in Node so Word-to-PDF output can be checked. */
async function pdfText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= doc.numPages; index += 1) {
    const page = await doc.getPage(index);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  await doc.cleanup();
  return { text: pages.join("\n"), pageCount: doc.numPages };
}

test.describe("PDF to Word", () => {
  test("produces editable headings, a real table, a picture and a page break", async ({ page }) => {
    test.setTimeout(180000);
    const { entries, xml } = await pdfToWord(page, await reportPdf());

    // Real Word heading styles, not bold paragraphs.
    const headingStyles = [...xml.matchAll(/<w:pStyle w:val="(Heading\d)"\/>/g)].map((match) => match[1]);
    expect(headingStyles.length).toBeGreaterThanOrEqual(3);
    expect(new Set(headingStyles).size).toBeGreaterThanOrEqual(2);

    // A genuine Word table with the source cell values.
    expect(xml).toContain("<w:tbl>");
    const tableRows = (xml.match(/<w:tr[ >]/g) ?? []).length;
    expect(tableRows).toBeGreaterThanOrEqual(4);
    for (const value of ["Region", "Units", "Revenue", "North", "1200", "48000", "South", "940"]) {
      expect(xml).toContain(value);
    }

    // A real embedded picture part, not a page screenshot.
    const media = Object.keys(entries).filter((name) => name.startsWith("word/media/"));
    expect(media.length).toBeGreaterThanOrEqual(1);

    // A page break between the two source pages.
    expect(xml).toContain('w:type="page"');

    // Body text survives.
    for (const phrase of ["Quarterly Operations Report", "Revenue grew by 18 percent", "Outlook", "Appendix"]) {
      expect(xml).toContain(phrase);
    }
  });

  test("never falls back to page screenshots in editable mode", async ({ page }) => {
    test.setTimeout(180000);
    const { entries, xml } = await pdfToWord(page, await reportPdf());
    const media = Object.keys(entries).filter((name) => name.startsWith("word/media/"));
    // One small content picture, not one full-page image per page.
    expect(media.length).toBeLessThanOrEqual(2);
    const extents = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].map((match) => ({
      width: Number(match[1]) / 12700,
      height: Number(match[2]) / 12700,
    }));
    for (const extent of extents) {
      expect(extent.width).toBeLessThan(400);
      expect(extent.height).toBeLessThan(400);
    }
  });

  test("rebuilds a resume-style page with real section headings and separate entries", async ({ page }) => {
    test.setTimeout(180000);
    // Mirrors a typical resume: 11pt ALL-CAPS headings over 10pt body text,
    // indented bullets and job titles that sit only 1pt apart. This is the
    // layout that used to collapse into one wall of text.
    const pdf = await PDFDocument.create();
    const body = await pdf.embedFont(StandardFonts.Helvetica);
    const page1 = pdf.addPage([595, 842]);
    const put = (text: string, x: number, y: number, size: number) =>
      page1.drawText(text, { x, y, size, font: body });

    put("PROFESSIONAL SUMMARY", 34, 760, 11);
    put("Final-year student with hands-on experience in SOC operations, VAPT and threat hunting.", 34, 742, 10);
    put("Founder of a security company building AI-powered solutions.", 34, 730, 10);
    put("SKILLS", 34, 706, 11);
    put("Security: SOC Operations, Threat Hunting, Incident Response, Detection Engineering, VAPT.", 34, 688, 10);
    put("Automation: SOAR, RAG, AI Security, Security Automation.", 34, 676, 10);
    put("EXPERIENCE", 34, 652, 11);
    put("Founder and Security Lead | NxtGenSec", 34, 634, 10);
    put("\u2022 Led cybersecurity workshops and mentorship programs.", 40, 622, 10);
    put("Cyber Security Intern | BlueCloud Softech Jun 2026 - Oct 2026", 34, 610, 10);
    put("\u2022 Built an end-to-end SOC pipeline with EDR and SIEM.", 40, 598, 10);
    put("PROJECTS", 34, 574, 11);
    put("APOS | Advanced Professional Office Suite | GitHub", 34, 556, 10);
    put("\u2022 Privacy-first office suite with browser-local PDF tools.", 40, 544, 10);

    const { xml } = await pdfToWord(page, Buffer.from(await pdf.save()));

    const headings = [...xml.matchAll(/<w:pStyle w:val="Heading(\d)"\/>/g)].map((match) => match[1]);
    expect(headings.length).toBeGreaterThanOrEqual(3);

    for (const heading of ["PROFESSIONAL SUMMARY", "SKILLS", "EXPERIENCE", "PROJECTS"]) {
      expect(xml).toContain(heading);
    }

    // Every bullet and every job title must be its own paragraph, not glued to
    // the line above it.
    const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((match) =>
      [...match[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((text) => text[1]).join(""),
    );
    const nonEmpty = paragraphs.filter((text) => text.trim());
    // Bullets become real Word numbering, so the marker is no longer text.
    expect(nonEmpty.some((text) => text.startsWith("Led cybersecurity workshops"))).toBe(true);
    expect(nonEmpty.some((text) => text.startsWith("Cyber Security Intern"))).toBe(true);
    expect(nonEmpty.some((text) => text.startsWith("Founder and Security Lead"))).toBe(true);
    expect(xml).toContain("<w:numPr>");
    expect(nonEmpty.some((text) => text.startsWith("\u2022"))).toBe(false);

    // No paragraph should swallow a heading plus the body that follows it.
    const walls = nonEmpty.filter((text) => text.length > 260);
    expect(walls).toEqual([]);
  });
});

test.describe("Word to PDF", () => {
  test("keeps every paragraph and the document title", async ({ page }) => {
    test.setTimeout(120000);
    const paragraphs = [
      "Quarterly Operations Report",
      "Revenue grew by 18 percent in the third quarter.",
      "The north region led growth with 1200 units shipped.",
      "The fourth quarter target is 3200 units across all regions.",
    ];
    const docx = buildDocx(paragraphs, "Quarterly Operations Report");

    await page.goto("/tools/document-to-pdf");
    await page.getByLabel("Choose a file").setInputFiles({
      name: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from(docx),
    });
    await page.getByRole("button", { name: "Create PDF" }).click();
    await expect(page.getByRole("link", { name: /Download .*\.pdf/ })).toBeVisible({ timeout: 60000 });

    const pending = page.waitForEvent("download");
    await page.getByRole("link", { name: /Download .*\.pdf/ }).click();
    const download = await pending;
    const path = await download.path();
    if (!path) throw new Error("PDF download was not saved.");
    const bytes = new Uint8Array(await readFile(path));

    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    const { text, pageCount } = await pdfText(bytes);
    expect(pageCount).toBeGreaterThanOrEqual(1);
    for (const phrase of ["Quarterly Operations Report", "Revenue grew by 18 percent", "3200 units"]) {
      expect(text).toContain(phrase);
    }
  });

  test("rejects a file that is not a document", async ({ page }) => {
    await page.goto("/tools/document-to-pdf");
    await page.getByLabel("Choose a file").setInputFiles({
      name: "broken.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from("this is not a zip package"),
    });
    await page.getByRole("button", { name: "Create PDF" }).click();
    await expect(page.locator(".merge-error")).toContainText("no readable document body", { timeout: 30000 });
    await expect(page.getByRole("link", { name: /Download .*\.pdf/ })).toHaveCount(0);
  });
});
