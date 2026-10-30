import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { rotatePdfBuffer } from "./rotate-pdf";

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

  it("rejects corrupt input and page ranges outside the document", async () => {
    await expect(rotatePdfBuffer(new Uint8Array(), [], 90, true)).rejects.toMatchObject({ code: "empty" });
    await expect(rotatePdfBuffer(new TextEncoder().encode("%PDF-1.7 corrupt"), [], 90, true)).rejects.toMatchObject({ code: "invalid-pdf" });
    await expect(rotatePdfBuffer(await fixture(), [{ first: 4, last: 4 }], 90)).rejects.toMatchObject({ code: "invalid-pages" });
  });
});
