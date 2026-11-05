import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { createDocument, type Document } from "./document-editor";
import { documentToPdf } from "./document-pdf";
import { checkPdfHeader } from "./pdf-limits";

function plainParagraph(text: string): Document["blocks"][number] {
  return { id: `b-${Math.random()}`, type: "paragraph", text: [{ text, marks: { bold: false, italic: false, underline: false } }] };
}

describe("documentToPdf", () => {
  it("writes a valid %PDF- file with at least one page", async () => {
    const doc = createDocument("Basic");
    doc.blocks = [plainParagraph("Hello world")];
    const result = await documentToPdf(doc);
    expect(result.pageCount).toBe(1);
    expect(checkPdfHeader(result.bytes)).toBe(true);

    const reopened = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(reopened.getPageCount()).toBe(1);
    expect(reopened.getTitle()).toBe("Basic");
  });

  it("paginates long content onto multiple pages", async () => {
    const doc = createDocument("Long");
    doc.blocks = [];
    for (let i = 0; i < 200; i++) {
      doc.blocks.push(plainParagraph(`Paragraph ${i + 1}. ${"Word ".repeat(30)}`));
    }
    const result = await documentToPdf(doc);
    expect(result.pageCount).toBeGreaterThan(1);
    const reopened = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(reopened.getPageCount()).toBe(result.pageCount);
  });

  it("respects Letter landscape and wide margins", async () => {
    const doc = createDocument("Landscape");
    doc.pageSettings = { ...doc.pageSettings, size: "Letter", orientation: "landscape", margin: "wide" };
    doc.blocks = [plainParagraph("Landscape content")];
    const result = await documentToPdf(doc);
    const reopened = await PDFDocument.load(result.bytes, { updateMetadata: false });
    const { width, height } = reopened.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
    expect(height).toBeLessThan(792);
  });

  it("renders headings, lists, and tables without error", async () => {
    const doc = createDocument("Rich");
    doc.blocks = [
      { id: "h1", type: "h1", text: [{ text: "Title", marks: { bold: true, italic: false, underline: false } }] },
      { id: "h2", type: "h2", text: [{ text: "Section", marks: { bold: true, italic: false, underline: false } }] },
      { id: "h3", type: "h3", text: [{ text: "Subsection", marks: { bold: true, italic: false, underline: false } }] },
      { id: "b1", type: "bullet", text: [{ text: "First", marks: { bold: false, italic: false, underline: false } }] },
      { id: "n1", type: "number", text: [{ text: "One", marks: { bold: false, italic: false, underline: false } }] },
      {
        id: "t1",
        type: "table",
        rows: [
          {
            id: "r1",
            cells: [
              { id: "c1", paragraphs: [[{ text: "A1", marks: { bold: false, italic: false, underline: false } }]] },
              { id: "c2", paragraphs: [[{ text: "B1", marks: { bold: false, italic: false, underline: false } }]] },
            ],
          },
          {
            id: "r2",
            cells: [
              { id: "c3", paragraphs: [[{ text: "A2", marks: { bold: false, italic: false, underline: false } }]] },
              { id: "c4", paragraphs: [[{ text: "B2", marks: { bold: false, italic: false, underline: false } }]] },
            ],
          },
        ],
      },
    ] as unknown as Document["blocks"];
    const result = await documentToPdf(doc);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(checkPdfHeader(result.bytes)).toBe(true);
  });

  it("renders links as blue text without failing", async () => {
    const doc = createDocument("Links");
    doc.blocks = [
      {
        id: "p1",
        type: "paragraph",
        text: [
          { text: "Visit ", marks: { bold: false, italic: false, underline: false } },
          { text: "Example", marks: { bold: false, italic: false, underline: true, link: "https://example.com" } },
        ],
      },
    ];
    const result = await documentToPdf(doc);
    expect(result.pageCount).toBe(1);
    const reopened = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(reopened.getPageCount()).toBe(1);
  });

  it("renders headers and footers via page tokens on every page", async () => {
    const doc = createDocument("Chrome");
    doc.pageSettings = {
      ...doc.pageSettings,
      header: "Page {{page}} of {{pages}}",
      footer: "Confidential",
      showPageNumbers: true,
    };
    doc.blocks = [];
    for (let i = 0; i < 120; i++) {
      doc.blocks.push(plainParagraph(`Line ${i + 1}. ${"Content ".repeat(20)}`));
    }
    const result = await documentToPdf(doc);
    expect(result.pageCount).toBeGreaterThan(1);
    const reopened = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(reopened.getPageCount()).toBe(result.pageCount);
  });

  it("renders images from data URLs and placeholders for unsupported sources", async () => {
    // 1x1 transparent PNG
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";
    const doc = createDocument("Images");
    doc.blocks = [
      { id: "img1", type: "image", src: png, alt: "pixel", width: 100, height: 100 },
      { id: "img2", type: "image", src: "data:image/webp;base64,UklGRiQAAABXRUJQVlA4WAoAAAAQAAAACwAAAACQwAAAAAA==", alt: "unsupported webp", width: 50, height: 50 },
    ] as unknown as Document["blocks"];
    const result = await documentToPdf(doc);
    expect(result.pageCount).toBe(1);
    const reopened = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(reopened.getPageCount()).toBe(1);
  });

  it("cancels cleanly when aborted", async () => {
    const doc = createDocument("Abort");
    doc.blocks = [plainParagraph("Hello")];
    const controller = new AbortController();
    controller.abort();
    await expect(documentToPdf(doc, { signal: controller.signal })).rejects.toThrowError();
  });
});
