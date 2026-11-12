import { describe, expect, it } from "vitest";
import {
  buildPdfPageStructure,
  buildTextBlocks,
  detectTables,
  groupTextLines,
  type PdfRawTextItem,
} from "./pdf-structured";

function item(str: string, x: number, y: number, width = str.length * 6, fontSize = 12, fontName = "Helvetica"): PdfRawTextItem {
  return { str, x, y, width, fontSize, fontName };
}

describe("PDF structured text extraction", () => {
  it("groups runs into visual lines and preserves word spacing", () => {
    const lines = groupTextLines([
      item("Hello", 40, 700, 30),
      item("world", 78, 700, 32),
      item("Second line", 40, 680, 70),
    ]);
    expect(lines.map((line) => line.text)).toEqual(["Hello world", "Second line"]);
  });

  it("reconstructs headings, paragraphs and lists from positioned text", () => {
    const structure = buildPdfPageStructure([
      item("Annual Report", 50, 780, 180, 24, "Helvetica-Bold"),
      item("This paragraph has a first line that should be joined", 50, 730, 300, 12),
      item("with its continuation line by the structured extractor.", 50, 712, 300, 12),
      item("A separately spaced paragraph follows here.", 50, 670, 250, 12),
      item("• First bullet", 50, 630, 110, 12),
      item("• Second bullet", 50, 612, 120, 12),
    ], 595, 842, 1);
    expect(structure.blocks[0]).toMatchObject({ kind: "heading", text: "Annual Report", level: 1 });
    const paragraph = structure.blocks.find((block) => block.kind === "paragraph");
    expect(paragraph).toMatchObject({ text: expect.stringContaining("continuation line") });
    expect(structure.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "list", text: "• First bullet" })]));
    expect(structure.text).toContain("Annual Report");
    expect(structure.page).toBe(1);
    expect(structure.empty).toBe(false);
  });

  it("detects aligned multi-column rows as a table and removes them from prose", () => {
    const items = [
      item("Invoice", 50, 790, 80, 20, "Helvetica-Bold"),
      item("Amount", 260, 750, 55, 11, "Helvetica-Bold"),
      item("Item", 50, 750, 25, 11, "Helvetica-Bold"),
      item("Rent", 50, 725, 30, 11),
      item("1200", 260, 725, 28, 11),
      item("Power", 50, 700, 38, 11),
      item("80", 260, 700, 14, 11),
      item("Totals follow below.", 50, 650, 130, 12),
    ];
    const structure = buildPdfPageStructure(items, 595, 842, 2);
    expect(structure.tables).toHaveLength(1);
    expect(structure.tables[0].rows).toEqual([
      ["Item", "Amount"],
      ["Rent", "1200"],
      ["Power", "80"],
    ]);
    expect(structure.blocks.some((block) => block.kind === "table")).toBe(true);
    expect(structure.text).toContain("Item\tAmount");
    expect(structure.text).toContain("Totals follow below.");
  });

  it("does not treat ordinary prose with one column as a table", () => {
    const lines = groupTextLines([
      item("A normal paragraph line that is long enough to wrap", 50, 700, 300),
      item("and continues on the next visual line without columns.", 50, 682, 300),
    ]);
    expect(detectTables(lines, 595, 842).tables).toHaveLength(0);
  });

  it("keeps Unicode text and reports an empty page honestly", () => {
    const structure = buildPdfPageStructure([
      item("日本語のテキスト", 50, 700, 100, 12),
      item("Ελληνικά — naïve façade", 50, 680, 160, 12),
    ], 595, 842, 3);
    expect(structure.text).toContain("日本語のテキスト");
    expect(structure.text).toContain("naïve façade");
    expect(structure.empty).toBe(false);
    const empty = buildPdfPageStructure([], 595, 842, 4);
    expect(empty.empty).toBe(true);
    expect(empty.text).toBe("");
  });

  it("orders headings and prose from top to bottom", () => {
    const { blocks } = buildTextBlocks(groupTextLines([
      item("Top heading", 50, 780, 100, 20, "Helvetica-Bold"),
      item("Body sentence.", 50, 730, 100),
      item("Bottom heading", 50, 680, 110, 18, "Helvetica-Bold"),
    ]), 595);
    expect(blocks.map((block) => block.text)).toEqual(["Top heading", "Body sentence.", "Bottom heading"]);
  });
});
