import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { mergePdfBuffers } from "./merge-pdf";
import { PDF_LIMITS } from "./pdf-limits";

async function fixture(width: number, height: number) {
  const pdf = await PDFDocument.create();
  pdf.addPage([width, height]);
  return new Uint8Array(await pdf.save());
}

describe("secure local PDF merge foundation", () => {
  it("merges in supplied order, reports progress and validates the result and page count", async () => {
    const first = await fixture(300, 400);
    const second = await fixture(500, 600);
    const progress: number[] = [];
    const merged = await mergePdfBuffers([first, second], (event) => progress.push(event.completed));
    const parsed = await PDFDocument.load(merged.bytes);
    expect(merged.pageCount).toBe(2);
    expect(parsed.getPages().map((page) => page.getSize())).toEqual([{ width: 300, height: 400 }, { width: 500, height: 600 }]);
    expect(progress.length).toBeGreaterThanOrEqual(4);
  });
  it("rejects wrong signatures and malformed documents", async () => {
    await expect(mergePdfBuffers([new Uint8Array([1, 2]), new Uint8Array([3])])).rejects.toMatchObject({ code: "wrong-signature" });
    const invalid = new TextEncoder().encode("%PDF-1.7 not a document");
    await expect(mergePdfBuffers([invalid, invalid])).rejects.toMatchObject({ code: "invalid-pdf" });
  });
  it("enforces count and per-file/combined byte limits", async () => {
    const tiny = await fixture(20, 20);
    await expect(mergePdfBuffers([tiny])).rejects.toMatchObject({ code: "too-few" });
    await expect(mergePdfBuffers(Array.from({ length: PDF_LIMITS.fileCount + 1 }, () => tiny))).rejects.toMatchObject({ code: "too-many" });
    await expect(mergePdfBuffers([new Uint8Array(PDF_LIMITS.perFileBytes + 1), tiny])).rejects.toMatchObject({ code: "too-large" });
  });
  it("enforces the combined byte limit before parsing files", async () => {
    const chunk = new Uint8Array(40 * 1024 * 1024);
    await expect(mergePdfBuffers([chunk, chunk, chunk])).rejects.toMatchObject({ code: "too-large" });
  });

  it("rejects an output exceeding the page limit", async () => {
    const pdf = await PDFDocument.create();
    for (let page = 0; page <= PDF_LIMITS.pages; page += 1) pdf.addPage([20, 20]);
    const oversized = new Uint8Array(await pdf.save());
    const tiny = await fixture(20, 20);
    await expect(mergePdfBuffers([oversized, tiny])).rejects.toMatchObject({ code: "too-many-pages" });
  });
});
