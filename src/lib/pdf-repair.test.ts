import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { diagnosePdf, repairPdfBuffer } from "./pdf-repair";
import { PdfInputError } from "./pdf-limits";

async function makePdf(pages = 3, width = 300, height = 400) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= pages; index += 1) {
    const page = document.addPage([width, height]);
    page.drawText(`Page ${index}`, { x: 30, y: 300, size: 18, font, color: rgb(0, 0, 0) });
  }
  document.setTitle("Repair me");
  document.setAuthor("APOS tests");
  return new Uint8Array(await document.save({ useObjectStreams: true }));
}

function breakStartxref(bytes: Uint8Array) {
  const text = new TextDecoder("latin1").decode(bytes);
  const broken = text.replace(/startxref\s+\d+\s+%%EOF\s*$/, "startxref\n999999\n%%EOF\n");
  return new Uint8Array(Array.from(broken, (character) => character.charCodeAt(0)));
}

describe("PDF structure repair", () => {
  it("rebuilds a healthy PDF without losing pages", async () => {
    const input = await makePdf(3);
    const { bytes, report } = await repairPdfBuffer(input);
    expect(report.pagesTotal).toBe(3);
    expect(report.pagesRecovered).toBe(3);
    expect(report.verified).toBe(true);
    expect(report.droppedPages).toEqual([]);
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(3);
  });

  it("detects and repairs a broken startxref while restoring metadata", async () => {
    const broken = breakStartxref(await makePdf(2));
    expect(diagnosePdf(broken).map((issue) => issue.code)).toContain("bad-startxref");
    const { bytes, report } = await repairPdfBuffer(broken);
    expect(report.issues.map((issue) => issue.code)).toContain("bad-startxref");
    expect(report.pagesRecovered).toBe(2);
    expect(report.verified).toBe(true);
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(2);
  });

  it("carries document information across a healthy document", async () => {
    const { bytes, report } = await repairPdfBuffer(await makePdf(1));
    expect(report.metadataRestored).toEqual(expect.arrayContaining(["Title", "Author"]));
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getTitle()).toBe("Repair me");
    expect(reopened.getAuthor()).toBe("APOS tests");
  });

  it("keeps page sizes exactly", async () => {
    const input = await makePdf(1, 500, 600);
    const { bytes } = await repairPdfBuffer(input);
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPage(0).getSize()).toEqual({ width: 500, height: 600 });
  });

  it("reports no structural issues for a clean file", async () => {
    expect(diagnosePdf(await makePdf(1))).toEqual([]);
  });

  it("refuses files that are not PDFs", async () => {
    await expect(repairPdfBuffer(new TextEncoder().encode("not a pdf"))).rejects.toMatchObject({ code: "wrong-signature" });
    await expect(repairPdfBuffer(new Uint8Array())).rejects.toMatchObject({ code: "empty" });
  });

  it("refuses encrypted documents instead of producing garbage", async () => {
    const bytes = await makePdf(1);
    const text = new TextDecoder("latin1").decode(bytes).replace("/Type /Catalog", "/Type /Catalog /Encrypt 9 0 R");
    const encrypted = new Uint8Array(Array.from(text, (character) => character.charCodeAt(0)));
    await expect(repairPdfBuffer(encrypted)).rejects.toBeInstanceOf(PdfInputError);
  });
});
