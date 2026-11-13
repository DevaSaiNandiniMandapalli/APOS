import { describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import {
  buildDocxDocument,
  buildXlsxWorkbook,
  readDocxParagraphs,
  readXlsxRows,
  validateDocxDocument,
  validateXlsxWorkbook,
} from "./office-formats";
import { PDFDocument } from "@cantoo/pdf-lib";
import { buildPdfHtml, buildPdfHtmlPackage, type HtmlPage } from "./pdf-html";

const PNG_1PX = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
);

describe("structured Word export", () => {
  it("writes headings, paragraphs, a table, a page break and an embedded picture", () => {
    const bytes = buildDocxDocument([
      { kind: "heading", text: "Quarterly report", level: 1 },
      { kind: "paragraph", text: "Revenue grew by 12%." },
      { kind: "table", rows: [["Region", "Revenue"], ["North", "1200"]], header: true },
      { kind: "pageBreak" },
      { kind: "heading", text: "Appendix", level: 2 },
      { kind: "image", bytes: PNG_1PX, format: "png", width: 100, height: 80 },
    ], "Report");
    const { entries, xml } = validateDocxDocument(bytes);
    expect(xml).toContain("Quarterly report");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("Revenue");
    expect(xml).toContain('w:type="page"');
    expect(xml).toContain("w:pStyle w:val=\"Heading1\"");
    expect(entries["word/styles.xml"]).toBeTruthy();
    expect(entries["word/media/image1.png"]).toBeTruthy();
    expect(readDocxParagraphs(bytes)).toEqual(expect.arrayContaining(["Quarterly report", "Revenue grew by 12%."]));
  });

  it("anchors pictures at their original page coordinates", () => {
    const bytes = buildDocxDocument([
      { kind: "paragraph", text: "Before" },
      { kind: "image", bytes: PNG_1PX, format: "png", width: 240, height: 160, anchor: { x: 100, y: 400, width: 180, height: 120, pageWidth: 595, pageHeight: 842, behindText: true } },
    ], "Anchored");
    const { xml } = validateDocxDocument(bytes);
    expect(xml).toContain("<wp:anchor");
    expect(xml).toContain('relativeFrom="page"');
    expect(xml).toContain('behindDoc="1"');
    expect(xml).toContain("<wp:positionH");
    expect(xml).toContain("<wp:positionV");
  });

  it("rejects a package whose image relationship points to a missing part", () => {
    const bytes = buildDocxDocument([{ kind: "image", bytes: PNG_1PX, format: "png", width: 10, height: 10 }]);
    const entries = unzipSync(bytes);
    const rels = new TextDecoder().decode(entries["word/_rels/document.xml.rels"]);
    entries["word/_rels/document.xml.rels"] = new TextEncoder().encode(rels.replace("media/", "media/missing-"));
    expect(() => validateDocxDocument(zipSync(entries))).toThrow();
  });
});

describe("multi-sheet Excel export", () => {
  it("writes and reads back multiple worksheets with header styling", () => {
    const bytes = buildXlsxWorkbook([
      { name: "Table 1", rows: [["Name", "Amount"], ["Rent", "1200"]], header: true },
      { name: "Table 2", rows: [["Item", "Qty"], ["Paper", "4"]], header: true },
      { name: "Extracted text", rows: [["Page", "Content"], ["1", "Hello"]], header: true },
    ], "Workbook");
    const validation = validateXlsxWorkbook(bytes);
    expect(validation.sheetCount).toBe(3);
    const entries = validation.entries;
    expect(new TextDecoder().decode(entries["xl/worksheets/sheet1.xml"])).toContain("Rent");
    expect(new TextDecoder().decode(entries["xl/worksheets/sheet2.xml"])).toContain("Paper");
    expect(new TextDecoder().decode(entries["xl/workbook.xml"])).toContain("Extracted text");
    expect(readXlsxRows(bytes)).toEqual([["Name", "Amount"], ["Rent", "1200"]]);
  });

  it("sanitises duplicate and invalid worksheet names", () => {
    const bytes = buildXlsxWorkbook([
      { name: "Table/1", rows: [["A"]] },
      { name: "Table/1", rows: [["B"]] },
    ]);
    const workbook = new TextDecoder().decode(validateXlsxWorkbook(bytes).entries["xl/workbook.xml"]);
    expect(workbook).not.toContain('name="Table/1"');
    expect((workbook.match(/<sheet /g) ?? []).length).toBe(2);
  });
});

function htmlPages(): HtmlPage[] {
  return [{
    page: 1,
    width: 595,
    height: 842,
    blocks: [
      { kind: "heading", text: "Findings", level: 1, y: 760 },
      { kind: "text", text: "A paragraph with <unsafe> text & symbols.", y: 720 },
      { kind: "table", rows: [["Name", "Value"], ["A", "1"]], header: true, y: 680, x: 40, width: 400, height: 40 },
      { kind: "image", dataUrl: `data:image/png;base64,${Buffer.from(PNG_1PX).toString("base64")}`, width: 1, height: 1, x: 40, y: 600, boxWidth: 100, boxHeight: 80, pageWidth: 595, pageHeight: 842 },
    ],
    lines: [{ text: "Findings", x: 40, y: 760, width: 70, fontSize: 20 }],
  }];
}

describe("HTML reading and layout output", () => {
  it("builds semantic, escaped HTML with headings, tables and pictures", () => {
    const html = buildPdfHtml("Report", htmlPages());
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<main>");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("<h3 class=\"pdf-heading level-1\">Findings</h3>");
    expect(html).toContain("<table>");
    expect(html).toContain("&lt;unsafe&gt;");
    expect(html).not.toContain("<unsafe>");
    expect(html).toContain("<img ");
    expect(html).toContain("data:image/png;base64,");
  });

  it("builds a layout view with positioned text and an independent ZIP package", () => {
    const html = buildPdfHtml("Report", htmlPages(), { mode: "layout" });
    expect(html).toContain("layout-line");
    expect(html).toContain("left:");
    expect(html).toContain("layout-table");
    const packaged = buildPdfHtmlPackage("Report", htmlPages(), { mode: "reading" });
    expect(packaged.archive[0]).toBe(0x50);
    expect(packaged.archive[1]).toBe(0x4b);
    const entries = unzipSync(packaged.archive);
    expect(Object.keys(entries)).toEqual(expect.arrayContaining(["index.html", "README.txt", "assets/page-1-picture-1.png"]));
    const index = new TextDecoder().decode(entries["index.html"]);
    expect(index).toContain('src="assets/page-1-picture-1.png"');
    expect(index).not.toContain("data:image/png;base64,");
  });
});

describe("PDF output sanity", () => {
  it("produces a PDF that the installed library can reopen", async () => {
    const document = await PDFDocument.create();
    document.addPage([100, 100]);
    const bytes = await document.save();
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(1);
  });
});
