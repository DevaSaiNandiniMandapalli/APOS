import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { parsePageRanges, splitPdfBuffer } from "./split-pdf";

async function fixture() {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]); pdf.addPage([500, 600]); pdf.addPage([700, 800]);
  return new Uint8Array(await pdf.save());
}

describe("local PDF splitting", () => {
  it("parses comma-separated pages and ordered ranges", () => {
    expect(parsePageRanges("1-2, 3", 3)).toEqual([{ first: 1, last: 2 }, { first: 3, last: 3 }]);
  });

  it.each(["", "1,,2", "0", "3-2", "1-4", "1-2,2-3", "all"])("rejects invalid or overlapping range input %s", (value) => {
    expect(() => parsePageRanges(value, 3)).toThrow();
  });

  it("creates parseable outputs containing the requested pages in order", async () => {
    const input = await fixture();
    const outputs = await splitPdfBuffer(input, parsePageRanges("3, 1-2", 3));
    expect(outputs).toHaveLength(2);
    const first = await PDFDocument.load(outputs[0]);
    const second = await PDFDocument.load(outputs[1]);
    expect(first.getPages().map((page) => page.getSize())).toEqual([{ width: 700, height: 800 }]);
    expect(second.getPages().map((page) => page.getSize())).toEqual([{ width: 300, height: 400 }, { width: 500, height: 600 }]);
  });

  it("rejects bad signatures and out-of-bounds ranges", async () => {
    await expect(splitPdfBuffer(new Uint8Array(), [{ first: 1, last: 1 }])).rejects.toMatchObject({ code: "empty" });
    await expect(splitPdfBuffer(new Uint8Array([1, 2]), [{ first: 1, last: 1 }])).rejects.toMatchObject({ code: "wrong-signature" });
    await expect(splitPdfBuffer(new TextEncoder().encode("%PDF-1.7 corrupt"), [{ first: 1, last: 1 }])).rejects.toMatchObject({ code: "invalid-pdf" });
    await expect(splitPdfBuffer(await fixture(), [{ first: 1, last: 4 }])).rejects.toMatchObject({ code: "invalid-pages" });
  });

  it("bounds the output file count", async () => {
    const input = await fixture();
    await expect(splitPdfBuffer(input, Array.from({ length: 21 }, () => ({ first: 1, last: 1 })))).rejects.toMatchObject({ code: "too-many-outputs" });
  });
});
