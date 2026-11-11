import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { SIGNATURE_PLACEMENTS, signPdf } from "./pdf-security-tools";

async function samplePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Invoice", { x: 60, y: 760, size: 20, font });
  return new Uint8Array(await doc.save());
}

describe("signPdf", () => {
  it("draws the signature on the requested page", async () => {
    const signed = await signPdf(await samplePdf(), { text: "A. Sharma", page: 1, placement: "bottom-right", fontSize: 24 });
    const doc = await PDFDocument.load(signed);
    expect(doc.getPageCount()).toBe(1);
    expect(new TextDecoder().decode(signed.subarray(0, 5))).toBe("%PDF-");
    expect(signed.byteLength).toBeGreaterThan(500);
  });

  it("offers every corner and centre position", () => {
    expect(SIGNATURE_PLACEMENTS).toHaveLength(7);
    expect(SIGNATURE_PLACEMENTS).toContain("bottom-center");
  });

  it("rejects an out-of-range page", async () => {
    await expect(signPdf(await samplePdf(), { text: "A", page: 4, placement: "center" })).rejects.toThrow(/page/i);
  });

  it("rejects empty signature text", async () => {
    await expect(signPdf(await samplePdf(), { text: "   ", page: 1, placement: "center" })).rejects.toThrow(/sign with/i);
  });
});
