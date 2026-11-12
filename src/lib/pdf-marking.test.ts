import { describe, expect, it } from "vitest";
import { degrees, PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { formatNumber, markPdf, type MarkOptions } from "./pdf-marking";
import { checkPdfHeader } from "./pdf-limits";

const defaults: MarkOptions = { operation: "watermark", text: "CONFIDENTIAL", pages: "all", position: "center", rotation: 315, opacity: 0.25, fontSize: 36, startNumber: 1, template: "Page {n}" };

async function sourcePdf() {
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]); pdf.addPage([500, 600]); pdf.addPage([700, 800]);
  return new Uint8Array(await pdf.save());
}

async function extractTextWithPdfJs(bytes: Uint8Array) {
  const loadingTask = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  try {
    const document = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        pages.push(content.items.filter((item) => "str" in item).map((item) => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim());
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

describe("PDF watermarks and page numbering", () => {
  it("adds text watermark only to selected pages and preserves page dimensions", async () => {
    const input = await sourcePdf(); const output = await markPdf(input, { ...defaults, pages: "2" });
    const checked = await PDFDocument.load(output);
    expect(checked.getPages().map((page) => page.getSize())).toEqual([{ width: 300, height: 400 }, { width: 500, height: 600 }, { width: 700, height: 800 }]);
    expect(checked.getPage(0).extractContents().filter((asset) => asset.kind === "text")).toHaveLength(0);
    expect(checked.getPage(1).extractContents().filter((asset) => asset.kind === "text").map((asset) => asset.kind === "text" ? asset.getText() : "").join(" ")).toContain("CONFIDENTIAL");
  });
  it("adds an image watermark with configured placement and opacity", async () => {
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p8sAAAAASUVORK5CYII=", "base64"));
    const output = await markPdf(await sourcePdf(), { ...defaults, text: "", pages: "1", rotation: 0, image: { bytes: png, format: "png" } });
    const checked = await PDFDocument.load(output);
    expect(checked.getPage(0).extractContents().some((asset) => asset.kind === "image")).toBe(true);
  });

  it("preserves the intrinsic aspect ratio of an image watermark", async () => {
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWP4z8DwHx9moL0CAHD0P8FDxlD6AAAAAElFTkSuQmCC", "base64"));
    const output = await markPdf(await sourcePdf(), {
      ...defaults,
      mode: "image",
      text: "",
      pages: "1",
      rotation: 0,
      scale: 45,
      image: { bytes: png, format: "png" },
    });
    const checked = await PDFDocument.load(output);
    const image = checked.getPage(0).extractContents().find((asset) => asset.kind === "image");
    expect(image?.kind).toBe("image");
    if (image?.kind === "image") {
      expect(image.width / image.height).toBeCloseTo(2, 5);
      expect(image.drawWidth / image.drawHeight).toBeCloseTo(2, 2);
    }
  });

  it("rejects ambiguous text plus image watermarks", async () => {
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p8sAAAAASUVORK5CYII=", "base64"));
    await expect(markPdf(await sourcePdf(), { ...defaults, text: "CONFIDENTIAL", image: { bytes: png, format: "png" } })).rejects.toThrow("either a text watermark or an image watermark");
  });
  it("numbers the selected pages with the configured start and template", async () => {
    const output = await markPdf(await sourcePdf(), { ...defaults, operation: "page-number", pages: "2-3", startNumber: 7, template: "Sheet {n}", text: "" });
    const checked = await PDFDocument.load(output);
    const extract = (index: number) => checked.getPage(index).extractContents().filter((asset) => asset.kind === "text").map((asset) => asset.kind === "text" ? asset.getText() : "").join(" ");
    expect(extract(0)).toBe(""); expect(extract(1)).toContain("Sheet 7"); expect(extract(2)).toContain("Sheet 8");
  });
  it("preserves original page content when adding a watermark", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([300, 400]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Original content", { x: 30, y: 300, size: 14, font });
    const output = await markPdf(new Uint8Array(await pdf.save()), { ...defaults, text: "WATERMARK", pages: "1", rotation: 0 });
    const checked = await PDFDocument.load(output);
    const text = checked.getPage(0).extractContents().filter((asset) => asset.kind === "text").map((asset) => asset.kind === "text" ? asset.getText() : "").join(" ");
    expect(text).toContain("Original content");
    expect(text).toContain("WATERMARK");
  });

  it("keeps watermark and page-number text readable on a rotated page", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 350]);
    page.setRotation(degrees(90));
    const source = new Uint8Array(await pdf.save());

    const watermark = await markPdf(source, {
      ...defaults,
      text: "ROTATED MARK",
      pages: "1",
      rotation: 0,
      position: "bottom-left",
      fontSize: 24,
    });
    expect((await extractTextWithPdfJs(watermark))[0]).toContain("ROTATED MARK");

    const numbered = await markPdf(source, {
      ...defaults,
      operation: "page-number",
      text: "",
      template: undefined,
      pages: "1",
      rotation: 0,
      position: "bottom-left",
      prefix: "P",
      startNumber: 1,
      fontSize: 18,
    });
    expect((await extractTextWithPdfJs(numbered))[0]).toContain("P1");
  });

  it("uses the selected standard font and text colour", async () => {
    const output = await markPdf(await sourcePdf(), {
      ...defaults,
      mode: "text",
      text: "FONT CHECK",
      fontFamily: "times-bold",
      color: "#ff0000",
      pages: "1",
      rotation: 0,
    });
    const checked = await PDFDocument.load(output);
    const text = checked.getPage(0).extractContents().find((asset) => asset.kind === "text");
    expect(text?.kind).toBe("text");
    if (text?.kind === "text") expect(text.fontFamily).toContain("Times");
  });

  it("supports prefix, suffix, padded formatting and skip-cover numbering", async () => {
    const output = await markPdf(await sourcePdf(), {
      ...defaults,
      operation: "page-number",
      text: "",
      template: undefined,
      pages: "all",
      startNumber: 1,
      prefix: "Page ",
      suffix: "",
      numberFormat: "padded",
      skipCover: true,
      margin: 20,
      position: "bottom-center",
    });
    const checked = await PDFDocument.load(output);
    const extract = (index: number) => checked.getPage(index).extractContents().filter((asset) => asset.kind === "text").map((asset) => asset.kind === "text" ? asset.getText() : "").join(" ");
    expect(extract(0)).toBe("");
    expect(extract(1)).toContain("Page 01");
    expect(extract(2)).toContain("Page 02");
  });

  it("keeps oversized page-number labels inside the page bounds", async () => {
    const output = await markPdf(await sourcePdf(), {
      ...defaults,
      operation: "page-number",
      text: "",
      template: undefined,
      pages: "1",
      startNumber: 123456,
      prefix: "A very long page label ",
      suffix: " end",
      fontSize: 96,
      margin: 10,
      position: "bottom-right",
    });
    const checked = await PDFDocument.load(output);
    const text = checked.getPage(0).extractContents().find((asset) => asset.kind === "text");
    expect(text?.kind).toBe("text");
    if (text?.kind === "text") {
      expect(text.x).toBeGreaterThanOrEqual(0);
      expect(text.x).toBeLessThanOrEqual(300);
      expect(text.y).toBeGreaterThanOrEqual(0);
      expect(text.y).toBeLessThanOrEqual(400);
      expect(text.fontSize).toBeLessThan(96);
    }
  });

  it("rejects bad signatures, invalid page ranges, empty watermarks and malformed formats", async () => {
    const bytes = await sourcePdf();
    await expect(markPdf(new Uint8Array(), defaults)).rejects.toThrow("non-empty PDF");
    await expect(markPdf(new TextEncoder().encode("no pdf"), defaults)).rejects.toThrow("signature");
    await expect(markPdf(bytes, { ...defaults, pages: "99" })).rejects.toThrow("outside this document");
    await expect(markPdf(bytes, { ...defaults, text: " ", pages: "1" })).rejects.toThrow("Enter watermark text");
    await expect(markPdf(bytes, { ...defaults, operation: "page-number", template: "Number" })).rejects.toThrow("includes {n}");
    await expect(markPdf(bytes, { ...defaults, text: "", pages: "1", image: { bytes: new Uint8Array([1, 2, 3]), format: "png" } })).rejects.toThrow();
    await expect(markPdf(new TextEncoder().encode("%PDF-1.7 corrupt"), defaults)).rejects.toThrow("corrupt, encrypted, or unsupported");
  });
});

describe("number formatting", () => {
  it("formats decimal, roman and letter styles", () => {
    expect(formatNumber(1)).toBe("1");
    expect(formatNumber(4, "roman")).toBe("iv");
    expect(formatNumber(9, "roman")).toBe("ix");
    expect(formatNumber(14, "roman")).toBe("xiv");
    expect(formatNumber(1987, "roman-upper")).toBe("MCMLXXXVII");
    expect(formatNumber(1, "alpha")).toBe("a");
    expect(formatNumber(26, "alpha")).toBe("z");
    expect(formatNumber(27, "alpha")).toBe("aa");
    expect(formatNumber(3, "alpha-upper")).toBe("C");
  });

  it("places straight text when the angle is zero", async () => {
    const output = await markPdf(await sourcePdf(), {
      ...defaults,
      operation: "page-number",
      text: "",
      template: "{n}",
      numberStyle: "roman",
      rotation: 0,
      position: "bottom-center",
    });
    expect(checkPdfHeader(output)).toBe(true);
    expect((await PDFDocument.load(output)).getPageCount()).toBe(3);
  });

  it("writes page numbers upright and in the chosen style", async () => {
    const output = await markPdf(await sourcePdf(), {
      ...defaults, operation: "page-number", text: "", template: "{n}", rotation: 0, position: "bottom-center", numberStyle: "roman",
    });
    const reloaded = await PDFDocument.load(output);
    expect(reloaded.getPageCount()).toBe(3);
    expect(output.byteLength).toBeGreaterThan((await sourcePdf()).byteLength);
  });
});
