import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { organizePdfBuffer } from "./organize-pdf";

async function fixture() {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]); pdf.addPage([500, 600]); pdf.addPage([700, 800]);
  return new Uint8Array(await pdf.save());
}

async function dimensions(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => page.getSize());
}

describe("PDF page organization", () => {
  it("deletes selected pages while retaining the other pages in order", async () => {
    const result = await organizePdfBuffer(await fixture(), { operation: "delete", pages: "2" });
    expect(result.pageCount).toBe(2);
    expect(await dimensions(result.bytes)).toEqual([{ width: 300, height: 400 }, { width: 700, height: 800 }]);
  });
  it("reorders every page in the specified order", async () => {
    const result = await organizePdfBuffer(await fixture(), { operation: "reorder", pages: "3,1-2" });
    expect(await dimensions(result.bytes)).toEqual([{ width: 700, height: 800 }, { width: 300, height: 400 }, { width: 500, height: 600 }]);
  });
  it("extracts selected pages into a smaller PDF", async () => {
    const result = await organizePdfBuffer(await fixture(), { operation: "extract", pages: "2-3" });
    expect(result.pageCount).toBe(2);
    expect(await dimensions(result.bytes)).toEqual([{ width: 500, height: 600 }, { width: 700, height: 800 }]);
  });
  it("duplicates selected pages to the end of the document", async () => {
    const result = await organizePdfBuffer(await fixture(), { operation: "duplicate", pages: "2" });
    expect(await dimensions(result.bytes)).toEqual([{ width: 300, height: 400 }, { width: 500, height: 600 }, { width: 700, height: 800 }, { width: 500, height: 600 }]);
  });
  it("inserts blank pages at the requested position using the adjacent page size", async () => {
    const result = await organizePdfBuffer(await fixture(), { operation: "add-blank", blankCount: 2, afterPage: 1 });
    expect(await dimensions(result.bytes)).toEqual([{ width: 300, height: 400 }, { width: 300, height: 400 }, { width: 300, height: 400 }, { width: 500, height: 600 }, { width: 700, height: 800 }]);
  });
  it("rejects deleting all pages, incomplete reorder lists and bad blank counts", async () => {
    const input = await fixture();
    await expect(organizePdfBuffer(input, { operation: "delete", pages: "1-3" })).rejects.toMatchObject({ code: "invalid-pages" });
    await expect(organizePdfBuffer(input, { operation: "reorder", pages: "1,3" })).rejects.toMatchObject({ code: "invalid-pages" });
    await expect(organizePdfBuffer(input, { operation: "add-blank", blankCount: 21, afterPage: 1 })).rejects.toMatchObject({ code: "invalid-pages" });
  });
  it("rejects empty, malformed, and out-of-range inputs", async () => {
    await expect(organizePdfBuffer(new Uint8Array(), { operation: "extract", pages: "1" })).rejects.toMatchObject({ code: "empty" });
    await expect(organizePdfBuffer(new TextEncoder().encode("%PDF-1.7 broken"), { operation: "extract", pages: "1" })).rejects.toMatchObject({ code: "invalid-pdf" });
    await expect(organizePdfBuffer(await fixture(), { operation: "extract", pages: "4" })).rejects.toMatchObject({ code: "invalid-pages" });
  });
});
