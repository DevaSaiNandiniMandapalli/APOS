import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { buildSearchablePdf, sanitizeOcrWord, type OcrPageImage } from "./pdf-ocr-searchable";

const ONE_PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

async function sourcePdf(pages: number) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) pdf.addPage([300, 400]);
  return new Uint8Array(await pdf.save());
}

function ocrPage(pageNumber: number): OcrPageImage {
  return {
    pageNumber,
    png: ONE_PIXEL_PNG,
    pixelWidth: 600,
    pixelHeight: 800,
    pointWidth: 300,
    pointHeight: 400,
    words: [
      { text: "Invoice", x0: 60, y0: 80, x1: 200, y1: 110 },
      { text: "Total", x0: 60, y0: 140, x1: 160, y1: 170 },
    ],
  };
}

describe("searchable PDF", () => {
  it("keeps every page and replaces only the OCR'd one", async () => {
    const output = await buildSearchablePdf(await sourcePdf(3), [ocrPage(2)]);
    const pdf = await PDFDocument.load(output, { updateMetadata: false });
    expect(pdf.getPageCount()).toBe(3);
    expect(new TextDecoder().decode(output.subarray(0, 5))).toBe("%PDF-");
  });

  it("uses the rendered page size for the OCR'd page", async () => {
    const output = await buildSearchablePdf(await sourcePdf(1), [ocrPage(1)]);
    const pdf = await PDFDocument.load(output, { updateMetadata: false });
    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.round(width)).toBe(300);
    expect(Math.round(height)).toBe(400);
  });

  it("rejects a file without a PDF signature", async () => {
    await expect(buildSearchablePdf(new TextEncoder().encode("not a pdf"), [ocrPage(1)])).rejects.toThrow(/signature/i);
  });

  it("requires at least one OCR'd page", async () => {
    await expect(buildSearchablePdf(await sourcePdf(1), [])).rejects.toThrow(/at least one page/i);
  });

  it("drops characters the built-in font cannot encode", () => {
    expect(sanitizeOcrWord("  Total  ")).toBe("Total");
    expect(sanitizeOcrWord("café")).toBe("café");
    expect(sanitizeOcrWord("日本語")).toBe("");
  });
});
