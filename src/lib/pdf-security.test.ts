import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { protectPdf } from "./pdf-security";

const user = "user-secret-123"; const owner = "owner-secret-456";
async function fixture() { const pdf = await PDFDocument.create(); pdf.addPage([300, 400]); return new Uint8Array(await pdf.save()); }

describe("PDF password protection and authorized unlocking", () => {
  it("encrypts with AES-256 and validates password-gated output", async () => {
    const output = await protectPdf(await fixture(), user, owner);
    await expect(PDFDocument.load(output)).rejects.toThrow();
    await expect(PDFDocument.load(output, { password: "wrong-password-123" })).rejects.toThrow();
    const opened = await PDFDocument.load(output, { password: user }); expect(opened.getPageCount()).toBe(1);
    const ownerOpened = await PDFDocument.load(output, { password: owner }); expect(ownerOpened.getPageCount()).toBe(1);
  });
  it("rejects weak/equal passwords and invalid files", async () => {
    const bytes = await fixture();
    await expect(protectPdf(bytes, "short", owner)).rejects.toThrow("at least 12 characters");
    await expect(protectPdf(bytes, user, user)).rejects.toThrow("different opening and owner");
    await expect(protectPdf(new Uint8Array(), user, owner)).rejects.toThrow("non-empty PDF");
  });
});
