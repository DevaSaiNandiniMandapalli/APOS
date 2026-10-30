import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { inspectPdfMetadata, updatePdfMetadata, type PdfMetadata } from "./pdf-metadata";

const base: PdfMetadata = { title: "Quarterly report", author: "A. User", subject: "Results", keywords: "finance annual", creator: "APOS test", producer: "Fixture" };
async function fixture() { const pdf = await PDFDocument.create(); pdf.addPage([300, 400]); pdf.setTitle(base.title); pdf.setAuthor(base.author); pdf.setSubject(base.subject); pdf.setKeywords(["finance", "annual"]); pdf.setCreator(base.creator); pdf.setProducer(base.producer); return new Uint8Array(await pdf.save()); }

describe("PDF metadata inspection and editing", () => {
  it("inspects supported standard document-information fields", async () => {
    const result = await inspectPdfMetadata(await fixture());
    expect(result.pageCount).toBe(1); expect(result.metadata).toEqual(base);
  });
  it("edits supported fields and reopens the actual output for verification", async () => {
    const changed = { ...base, title: "Updated report", keywords: "reviewed final", author: "B. User" };
    const output = await updatePdfMetadata(await fixture(), changed);
    const checked = await inspectPdfMetadata(output);
    expect(checked.pageCount).toBe(1); expect(checked.metadata).toEqual(changed);
  });
  it("supports clearing metadata and rejects invalid documents or unsafe values", async () => {
    const bytes = await fixture(); const empty = Object.fromEntries(Object.keys(base).map((field) => [field, ""])) as PdfMetadata;
    const output = await updatePdfMetadata(bytes, empty);
    expect(Object.values((await inspectPdfMetadata(output)).metadata).every((value) => value === "")).toBe(true);
    await expect(inspectPdfMetadata(new Uint8Array())).rejects.toThrow("non-empty PDF");
    await expect(inspectPdfMetadata(new TextEncoder().encode("not a PDF"))).rejects.toThrow("signature");
    await expect(inspectPdfMetadata(new TextEncoder().encode("%PDF-1.7 corrupt"))).rejects.toThrow("corrupt, encrypted, or unsupported");
    await expect(updatePdfMetadata(bytes, { ...base, title: "x".repeat(1001) })).rejects.toThrow("1,000 characters");
  });
});
