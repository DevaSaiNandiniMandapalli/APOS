import { describe, expect, it } from "vitest";
import { degrees, PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { rotatePdfBuffer, rotatePdfPages } from "./rotate-pdf";

async function fixture() {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]); pdf.addPage([500, 600]); pdf.addPage([700, 800]);
  return new Uint8Array(await pdf.save());
}

describe("local PDF rotation", () => {
  it.each([90, 180, 270] as const)("rotates all pages by %i degrees", async (angle) => {
    const result = await rotatePdfBuffer(await fixture(), [], angle, true);
    const checked = await PDFDocument.load(result.bytes);
    expect(result.pageCount).toBe(3);
    expect(checked.getPages().map((page) => page.getRotation().angle)).toEqual([angle, angle, angle]);
    expect(checked.getPages().map((page) => page.getSize())).toEqual([{ width: 300, height: 400 }, { width: 500, height: 600 }, { width: 700, height: 800 }]);
  });

  it("rotates only selected pages and preserves document order", async () => {
    const result = await rotatePdfBuffer(await fixture(), [{ first: 2, last: 2 }], 90);
    const checked = await PDFDocument.load(result.bytes);
    expect(checked.getPages().map((page) => page.getRotation().angle)).toEqual([0, 90, 0]);
    expect(checked.getPages().map((page) => page.getSize())).toEqual([{ width: 300, height: 400 }, { width: 500, height: 600 }, { width: 700, height: 800 }]);
  });

  it("applies independent rotations and accumulates existing page rotations", async () => {
    const pdf = await PDFDocument.create();
    const first = pdf.addPage([300, 400]);
    const second = pdf.addPage([500, 600]);
    pdf.addPage([700, 800]);
    first.setRotation(degrees(90));
    second.setRotation(degrees(270));
    const result = await rotatePdfPages(new Uint8Array(await pdf.save()), { 1: 90, 2: 90, 3: 270 });
    const checked = await PDFDocument.load(result.bytes);
    expect(checked.getPages().map((page) => page.getRotation().angle)).toEqual([180, 0, 270]);
  });

  it("preserves page content while changing rotation", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([300, 400]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Keep this content", { x: 30, y: 300, size: 14, font });
    const result = await rotatePdfPages(new Uint8Array(await pdf.save()), { 1: 90 });
    const checked = await PDFDocument.load(result.bytes);
    expect(checked.getPage(0).getRotation().angle).toBe(90);
    expect(checked.getPage(0).extractContents().some((asset) => asset.kind === "text" && asset.getText().includes("Keep this content"))).toBe(true);
  });

  it("rejects corrupt input, invalid angles and page ranges outside the document", async () => {
    await expect(rotatePdfBuffer(new Uint8Array(), [], 90, true)).rejects.toMatchObject({ code: "empty" });
    await expect(rotatePdfBuffer(new TextEncoder().encode("%PDF-1.7 corrupt"), [], 90, true)).rejects.toMatchObject({ code: "invalid-pdf" });
    await expect(rotatePdfBuffer(await fixture(), [{ first: 4, last: 4 }], 90)).rejects.toMatchObject({ code: "invalid-pages" });
    await expect(rotatePdfPages(await fixture(), { 1: 45 })).rejects.toMatchObject({ code: "invalid-pages" });
  });
});
