import { describe, expect, it, vi } from "vitest";
import { extractPdfDocumentText, type PdfTextDocument, type PdfTextPage } from "./pdf-to-text";

function makePage(items: Array<{ str: string; hasEOL?: boolean }>) {
  return {
    getTextContent: vi.fn(async () => ({ items })),
    cleanup: vi.fn(),
  } as unknown as PdfTextPage;
}

function makeDocument(pages: PdfTextPage[]): PdfTextDocument {
  return { numPages: pages.length, getPage: vi.fn(async (page) => pages[page - 1]), destroy: vi.fn(async () => undefined) } as unknown as PdfTextDocument;
}

describe("PDF text extraction", () => {
  it("extracts page text in page order, applies page labels and reports measured progress", async () => {
    const first = makePage([{ str: "First line", hasEOL: true }, { str: "continued" }]);
    const second = makePage([{ str: "Second page" }]);
    const document = makeDocument([first, second]);
    const progress: Array<{ completedPages: number; totalPages: number }> = [];
    const output = await extractPdfDocumentText(document, { includePageLabels: true }, new AbortController().signal, (item) => progress.push(item));
    expect(new TextDecoder().decode(output.bytes)).toBe("--- Page 1 ---\nFirst line\ncontinued\n\n--- Page 2 ---\nSecond page");
    expect(output.pageCount).toBe(2);
    expect(output.characterCount).toBeGreaterThan(0);
    expect(progress).toEqual([{ completedPages: 0, totalPages: 2 }, { completedPages: 1, totalPages: 2 }, { completedPages: 2, totalPages: 2 }]);
    expect(first.cleanup).toHaveBeenCalledOnce();
    expect(second.cleanup).toHaveBeenCalledOnce();
  });

  it("supports plain text output and documents pages without selectable text", async () => {
    const document = makeDocument([makePage([]), makePage([{ str: "Readable" }])]);
    const output = await extractPdfDocumentText(document, { includePageLabels: false }, new AbortController().signal, () => undefined);
    expect(new TextDecoder().decode(output.bytes)).toBe("\n\nReadable");
    expect(output.emptyPages).toEqual([1]);
  });

  it("extracts only the requested page range in the entered order", async () => {
    const document = makeDocument([makePage([{ str: "One" }]), makePage([{ str: "Two" }]), makePage([{ str: "Three" }])]);
    const output = await extractPdfDocumentText(document, { includePageLabels: true, pages: "3, 1" }, new AbortController().signal, () => undefined);
    const text = new TextDecoder().decode(output.bytes);
    expect(text).toContain("--- Page 3 ---\nThree");
    expect(text).toContain("--- Page 1 ---\nOne");
    expect(text).not.toContain("Page 2");
    expect(output.selectedPages).toEqual([3, 1]);
    expect(output.pageCount).toBe(2);
  });

  it("honors cancellation and rejects page counts outside configured limits", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(extractPdfDocumentText(makeDocument([makePage([])]), { includePageLabels: true }, controller.signal, () => undefined)).rejects.toMatchObject({ name: "AbortError" });
    const oversized = { numPages: 501, getPage: vi.fn(), destroy: vi.fn() } as unknown as PdfTextDocument;
    await expect(extractPdfDocumentText(oversized, { includePageLabels: true }, new AbortController().signal, () => undefined)).rejects.toThrow("1-500 pages");
  });
});
