import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { compressPdfBuffer, compressionSizeReport } from "./compress-pdf";

const pixelPng = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=", "base64"));

async function textPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 8; index += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`Text based report page ${index + 1}`, { x: 40, y: 740, font, size: 18 });
  }
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}

async function imagePdf(includeText: boolean) {
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(pixelPng);
  const font = includeText ? await pdf.embedFont(StandardFonts.Helvetica) : null;
  for (let index = 0; index < 8; index += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawImage(image, { x: 40, y: 400, width: 400, height: 300 });
    if (font) page.drawText(`Mixed document ${index + 1}`, { x: 40, y: 350, font, size: 16 });
  }
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}

describe("browser-local PDF compression rewrite", () => {
  it("never describes a larger or equal output as a reduction", () => {
    expect(compressionSizeReport(1000, 900)).toContain("Reduced by");
    expect(compressionSizeReport(1000, 1000)).toContain("No size reduction");
    expect(compressionSizeReport(1000, 1100)).toBe("No size reduction: the output is 0.1 KB larger.");
  });
  it.each([["text-based", textPdf], ["image-heavy", () => imagePdf(false)], ["mixed", () => imagePdf(true)]] as const)("validates %s PDFs and reports measured byte sizes", async (_label, makeInput) => {
    const input = await makeInput();
    const result = await compressPdfBuffer(input);
    const parsed = await PDFDocument.load(result.bytes);
    expect(result.inputBytes).toBe(input.byteLength);
    expect(result.outputBytes).toBe(result.bytes.byteLength);
    expect(parsed.getPageCount()).toBe(8);
    expect(parsed.getPages().map((page) => page.getSize())).toEqual(Array.from({ length: 8 }, () => ({ width: 612, height: 792 })));
  });
  it("rejects empty, wrong-signature, and corrupt PDFs", async () => {
    await expect(compressPdfBuffer(new Uint8Array())).rejects.toMatchObject({ code: "empty" });
    await expect(compressPdfBuffer(new Uint8Array([1, 2]))).rejects.toMatchObject({ code: "wrong-signature" });
    await expect(compressPdfBuffer(new TextEncoder().encode("%PDF-1.7 corrupt"))).rejects.toMatchObject({ code: "invalid-pdf" });
  });
});
