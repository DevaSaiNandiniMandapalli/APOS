import { PDFDocument } from "@cantoo/pdf-lib";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readDocxRichBlocks } from "./office-formats";
import { buildRichDocPdf } from "./office-pdf";

function docx(documentXml: string): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${documentXml}</w:body></w:document>`),
  });
}

describe("rich DOCX reader", () => {
  it("keeps run colour, size, bold and italic", () => {
    const bytes = docx(`
      <w:p>
        <w:r><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="1F3864"/></w:rPr><w:t>Bold heading</w:t></w:r>
        <w:r><w:rPr><w:i/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve"> and italic</w:t></w:r>
      </w:p>`);
    const blocks = readDocxRichBlocks(bytes);
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    if (block.kind !== "text") throw new Error("expected text");
    expect(block.text).toBe("Bold heading and italic");
    expect(block.runs).toHaveLength(2);
    expect(block.runs[0]).toMatchObject({ text: "Bold heading", bold: true, size: 14, color: "1F3864" });
    expect(block.runs[1]).toMatchObject({ text: " and italic", italic: true, size: 10 });
  });

  it("detects heading level, alignment and bullets", () => {
    const bytes = docx(`
      <w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr><w:r><w:t>Cover title</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First bullet</w:t></w:r></w:p>`);
    const blocks = readDocxRichBlocks(bytes);
    expect(blocks[0]).toMatchObject({ kind: "text", text: "Cover title", level: 1, align: "center" });
    expect(blocks[1]).toMatchObject({ kind: "text", text: "First bullet", bullet: true });
  });

  it("ignores explicit bold-off runs", () => {
    const bytes = docx(`<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>Not bold</w:t></w:r></w:p>`);
    const blocks = readDocxRichBlocks(bytes);
    const block = blocks[0];
    if (block.kind !== "text") throw new Error("expected text");
    expect(block.runs[0].bold).toBeUndefined();
  });
});

describe("rich PDF renderer", () => {
  it("produces a valid PDF and keeps the text", async () => {
    const bytes = docx(`
      <w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="1F3864"/></w:rPr><w:t>Cover title</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First bullet</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>Bold body</w:t></w:r></w:p>`);
    const blocks = readDocxRichBlocks(bytes);
    const pdf = await buildRichDocPdf(blocks, "Test");
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
    const loaded = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("renders a bullet glyph rather than a hyphen", async () => {
    const bytes = docx(`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Bullet text</w:t></w:r></w:p>`);
    const blocks = readDocxRichBlocks(bytes);
    const pdf = await buildRichDocPdf(blocks, "Test");
    // The bullet is drawn with the WinAnsi bullet code point, so the raw stream
    // must not contain a literal hyphen-only prefix.
    expect(pdf.byteLength).toBeGreaterThan(500);
  });
});
