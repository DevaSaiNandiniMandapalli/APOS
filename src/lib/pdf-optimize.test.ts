import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { DEFAULT_OPTIMIZE_OPTIONS, optimizePdfBuffer, optimizeSummary, formatBytes } from "./pdf-optimize";

async function makePdf(pages = 2) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= pages; index += 1) {
    const page = document.addPage([420, 595]);
    page.drawText(`Optimise page ${index}`, { x: 40, y: 500, size: 16, font, color: rgb(0, 0, 0) });
  }
  document.setTitle("Optimise me");
  document.setAuthor("APOS tests");
  document.setSubject("A subject");
  document.setCreator("Test suite");
  return new Uint8Array(await document.save());
}

describe("PDF optimization", () => {
  it("rewrites a document and reports measured bytes", async () => {
    const input = await makePdf(2);
    const { bytes, report } = await optimizePdfBuffer(input, DEFAULT_OPTIMIZE_OPTIONS);
    expect(report.verified).toBe(true);
    expect(report.pageCount).toBe(2);
    expect(report.inputBytes).toBe(input.byteLength);
    expect(report.outputBytes).toBe(bytes.byteLength);
    expect(report.savedBytes).toBe(input.byteLength - bytes.byteLength);
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(2);
  });

  it("clears metadata only when asked", async () => {
    const input = await makePdf(1);
    const kept = await optimizePdfBuffer(input, DEFAULT_OPTIMIZE_OPTIONS);
    expect(kept.report.metadataCleared).toEqual([]);
    const cleared = await optimizePdfBuffer(input, { ...DEFAULT_OPTIMIZE_OPTIONS, removeMetadata: true });
    expect(cleared.report.metadataCleared).toEqual(expect.arrayContaining(["Title", "Author"]));
    const reopened = await PDFDocument.load(cleared.bytes);
    expect(reopened.getTitle()).toBeFalsy();
    expect(reopened.getAuthor()).toBeFalsy();
  });

  it("flattens form fields and counts them", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([420, 595]);
    const form = document.getForm();
    const field = form.createTextField("customer.name");
    field.setText("Northwind");
    field.addToPage(page, { x: 40, y: 500, width: 200, height: 24, font });
    const input = new Uint8Array(await document.save());
    const { bytes, report } = await optimizePdfBuffer(input, { ...DEFAULT_OPTIMIZE_OPTIONS, flattenForms: true });
    expect(report.fieldsFlattened).toBe(1);
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getForm().getFields().length).toBe(0);
  });

  it("describes the size change in plain words", async () => {
    expect(optimizeSummary({ inputBytes: 1000, outputBytes: 600, savedBytes: 400, savedPercent: 40, pageCount: 1, metadataCleared: [], fieldsFlattened: 0, notes: [], verified: true })).toContain("Saved 0.4 KB");
    expect(optimizeSummary({ inputBytes: 1000, outputBytes: 1000, savedBytes: 0, savedPercent: 0, pageCount: 1, metadataCleared: [], fieldsFlattened: 0, notes: [], verified: true })).toBe("The rewritten PDF is the same size.");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("rejects files that are not PDFs", async () => {
    await expect(optimizePdfBuffer(new TextEncoder().encode("nope"), DEFAULT_OPTIMIZE_OPTIONS)).rejects.toMatchObject({ code: "wrong-signature" });
  });
});
