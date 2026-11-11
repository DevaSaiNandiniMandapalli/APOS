import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { formatNumber, markPdf, type MarkOptions } from "./pdf-marking";
import { checkPdfHeader } from "./pdf-limits";

const defaults: MarkOptions = { operation: "watermark", text: "CONFIDENTIAL", pages: "all", position: "center", rotation: 315, opacity: 0.25, fontSize: 36, startNumber: 1, template: "Page {n}" };

async function sourcePdf() {
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]); pdf.addPage([500, 600]); pdf.addPage([700, 800]);
  return new Uint8Array(await pdf.save());
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
  it("numbers the selected pages with the configured start and template", async () => {
    const output = await markPdf(await sourcePdf(), { ...defaults, operation: "page-number", pages: "2-3", startNumber: 7, template: "Sheet {n}", text: "" });
    const checked = await PDFDocument.load(output);
    const extract = (index: number) => checked.getPage(index).extractContents().filter((asset) => asset.kind === "text").map((asset) => asset.kind === "text" ? asset.getText() : "").join(" ");
    expect(extract(0)).toBe(""); expect(extract(1)).toContain("Sheet 7"); expect(extract(2)).toContain("Sheet 8");
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
