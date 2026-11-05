import { describe, expect, it } from "vitest";
import { zipSync, strToU8, unzipSync } from "fflate";
import { buildDocx, buildXlsx, readDocxParagraphs, readPptxSlides, readXlsxRows } from "./office-formats";
import { baseName, parseDelimited, paragraphsFromPlainText } from "./office-convert";
import { normaliseTable, toPdfSafeText, wrapText, buildParagraphPdf } from "./office-pdf";

describe("office formats", () => {
  it("writes a Word document that reads back paragraph by paragraph", () => {
    const bytes = buildDocx(["First paragraph", "Second & last"], "Report");
    const entries = unzipSync(bytes);
    expect(Object.keys(entries)).toContain("word/document.xml");
    expect(readDocxParagraphs(bytes)).toEqual(["First paragraph", "Second & last"]);
  });

  it("writes a workbook that reads back as rows", () => {
    const bytes = buildXlsx([["Name", "Amount"], ["Rent", "1200"]], "Costs");
    expect(readXlsxRows(bytes)).toEqual([["Name", "Amount"], ["Rent", "1200"]]);
  });

  it("reads slide text in order", () => {
    const pptx = zipSync({
      "ppt/slides/slide1.xml": strToU8("<p:sld><a:p><a:r><a:t>Title</a:t></a:r></a:p><a:p><a:r><a:t>Point one</a:t></a:r></a:p></p:sld>"),
      "ppt/slides/slide2.xml": strToU8("<p:sld><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>"),
    });
    expect(readPptxSlides(pptx)).toEqual([["Title", "Point one"], ["Second slide"]]);
  });

  it("rejects a zip that is not an Office file", () => {
    expect(() => readDocxParagraphs(strToU8("not a zip"))).toThrow("no readable document body");
  });
});

describe("conversion helpers", () => {
  it("parses quoted CSV", () => {
    expect(parseDelimited('a,b\n"c,d",e')).toEqual([["a", "b"], ["c,d", "e"]]);
  });

  it("splits plain text into paragraphs", () => {
    expect(paragraphsFromPlainText("One\nline\n\nTwo")).toEqual(["One\nline", "Two"]);
  });

  it("sanitises output file names", () => {
    expect(baseName("Q3 Report.pdf")).toBe("Q3 Report");
    expect(baseName("...")).toBe("document");
  });
});

describe("PDF export", () => {
  it("maps unsupported characters", () => {
    expect(toPdfSafeText("“Quote” — dash\nnext")).toBe('"Quote" - dash\nnext');
  });

  it("normalises table widths", () => {
    expect(normaliseTable([["a", "b", "c"], ["d"]])).toEqual([["a", "b", "c"], ["d", "", ""]]);
  });

  it("wraps long text to the page width", async () => {
    const { PDFDocument, StandardFonts } = await import("@cantoo/pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = wrapText("word ".repeat(200), font, 11, 300);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.every((line) => font.widthOfTextAtSize(line, 11) <= 300.5)).toBe(true);
  });

  it("produces a valid PDF header", async () => {
    const bytes = await buildParagraphPdf(["Hello world"], "Test");
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});
