import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import {
  buildEqualRanges,
  buildEveryPageRanges,
  extractPdfPages,
  formatPageRanges,
  pagesToRanges,
  parsePageRanges,
  splitPdfBuffer,
} from "./split-pdf";

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

  it("extracts selected pages into one PDF in page order", async () => {
    const result = await extractPdfPages(await fixture(), [3, 1]);
    const parsed = await PDFDocument.load(result.bytes);
    expect(result.pageCount).toBe(2);
    expect(parsed.getPages().map((page) => page.getSize())).toEqual([{ width: 300, height: 400 }, { width: 700, height: 800 }]);
  });

  it("builds every-page, equal-group and canonical range selections", async () => {
    expect(buildEveryPageRanges(3)).toEqual([{ first: 1, last: 1 }, { first: 2, last: 2 }, { first: 3, last: 3 }]);
    expect(buildEqualRanges(5, 2)).toEqual([{ first: 1, last: 2 }, { first: 3, last: 4 }, { first: 5, last: 5 }]);
    expect(pagesToRanges([5, 1, 2, 3])).toEqual([{ first: 1, last: 3 }, { first: 5, last: 5 }]);
    expect(formatPageRanges([{ first: 1, last: 3 }, { first: 5, last: 5 }])).toBe("1-3, 5");
  });

  it("rejects bad signatures, out-of-bounds ranges and duplicate ranges", async () => {
    await expect(splitPdfBuffer(new Uint8Array(), [{ first: 1, last: 1 }])).rejects.toMatchObject({ code: "empty" });
    await expect(splitPdfBuffer(new Uint8Array([1, 2]), [{ first: 1, last: 1 }])).rejects.toMatchObject({ code: "wrong-signature" });
    await expect(splitPdfBuffer(new TextEncoder().encode("%PDF-1.7 corrupt"), [{ first: 1, last: 1 }])).rejects.toMatchObject({ code: "invalid-pdf" });
    await expect(splitPdfBuffer(await fixture(), [{ first: 1, last: 4 }])).rejects.toMatchObject({ code: "invalid-pages" });
    await expect(splitPdfBuffer(await fixture(), [{ first: 1, last: 1 }, { first: 1, last: 1 }])).rejects.toMatchObject({ code: "invalid-pages" });
  });

  it("creates one output per page and one output per equal group", async () => {
    const input = await fixture();
    const pages = await splitPdfBuffer(input, buildEveryPageRanges(3));
    expect(pages).toHaveLength(3);
    expect((await PDFDocument.load(pages[2])).getPages()[0].getSize()).toEqual({ width: 700, height: 800 });
    const groups = await splitPdfBuffer(input, buildEqualRanges(3, 2));
    expect(groups).toHaveLength(2);
    expect((await PDFDocument.load(groups[0])).getPageCount()).toBe(2);
    expect((await PDFDocument.load(groups[1])).getPageCount()).toBe(1);
  });
});
