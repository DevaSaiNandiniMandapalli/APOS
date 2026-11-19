import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { SIGNATURE_PLACEMENTS, signPdf, unlockPdf } from "./pdf-security-tools";

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

describe("unlockPdf", () => {
  it("removes encryption while keeping a selectable text layer", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([400, 500]).drawText("KEEP THIS TEXT", { x: 30, y: 400, size: 16, font });
    pdf.encrypt({ userPassword: "userpass123", ownerPassword: "ownerpass123", algorithm: "AES-256" });
    const file = new File([new Uint8Array(await pdf.save()) as unknown as BlobPart], "locked.pdf", { type: "application/pdf" });
    const result = await unlockPdf(file, "userpass123");
    expect(result.mode).toBe("text");
    const opened = await PDFDocument.load(result.bytes);
    expect(opened.isEncrypted).toBe(false);
    expect(opened.getPageCount()).toBe(1);
    expect(result.bytes.byteLength).toBeGreaterThan(500);
  });
});
