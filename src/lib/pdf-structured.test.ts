import { describe, expect, it } from "vitest";
import {
  buildPdfPageStructure,
  buildTextBlocks,
  detectHorizontalRules,
  detectVerticalRules,
  detectTables,
  groupTextLines,
  tableHasBorders,
  type PdfLine,
  type PdfRawTextItem,
} from "./pdf-structured";

function item(str: string, x: number, y: number, width = str.length * 6, fontSize = 12, fontName = "Helvetica"): PdfRawTextItem {
  return { str, x, y, width, fontSize, fontName };
}

function line(text: string, x: number, y: number, width: number, fontSize = 10, bold = false): PdfLine {
  return { text, x, y, width, fontSize, bold, italic: false, fontName: "Helvetica", cells: [{ text, x, width }] };
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

  it("detects short ALL-CAPS section headings only slightly larger than body text", () => {
    // A resume-style page: 11pt headings over 10pt body, with no bold metadata.
    const { blocks } = buildTextBlocks([
      line("PROFESSIONAL SUMMARY", 34, 700, 122, 11),
      line("Final-year student with hands-on experience in SOC operations and VAPT work.", 34, 682, 520, 10),
      line("EDUCATION", 34, 660, 55, 11),
      line("B.Tech, Computer Science and Engineering", 34, 642, 300, 10),
    ], 595);
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 3, text: "PROFESSIONAL SUMMARY" });
    expect(blocks[2]).toMatchObject({ kind: "heading", level: 3, text: "EDUCATION" });
  });

  it("keeps a wrapped paragraph together but splits when the previous line stops short", () => {
    const { blocks } = buildTextBlocks([
      line("A full width line that establishes the right edge of the text column here", 34, 700, 520, 10),
      line("and this continuation belongs to the same paragraph.", 34, 688, 250, 10),
      line("A new entry starts on its own line", 34, 676, 200, 10),
    ], 595);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toContain("continuation belongs");
    expect(blocks[1].text).toBe("A new entry starts on its own line");
  });

  it("gives every bullet its own paragraph and ends the list at an outdented line", () => {
    const { blocks } = buildTextBlocks([
      line("Founder and Security Lead", 34, 700, 200, 10),
      line("• Led workshops and mentorship programs.", 40, 688, 300, 10),
      line("• Built an end-to-end SOC pipeline.", 40, 676, 260, 10),
      line("Cyber Security Intern", 34, 664, 180, 10),
    ], 595);
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "list", "list", "paragraph"]);
    expect(blocks[3].text).toBe("Cyber Security Intern");
  });

  it("starts a new paragraph when the previous line closes a label", () => {
    const { blocks } = buildTextBlocks([
      line("Full Stack Development Intern | Academy Apr 2025 - May 2025 (Online)", 34, 700, 520, 10),
      line("Cyber Security Trainer and Resource Person", 34, 688, 200, 10),
    ], 595);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].text).toBe("Cyber Security Trainer and Resource Person");
  });

  it("does not turn a long ALL-CAPS sentence into a heading", () => {
    const { blocks } = buildTextBlocks([
      line("THIS SENTENCE IS DELIBERATELY LONG ENOUGH THAT IT MUST STAY A PARAGRAPH", 34, 700, 520, 10),
    ], 595);
    expect(blocks[0].kind).toBe("paragraph");
  });

  it("finds horizontal rules and attaches them to the heading above", () => {
    const fakePdfjs = { OPS: { constructPath: 91 } } as unknown as Parameters<typeof detectHorizontalRules>[0];
    const viewport = { transform: [1, 0, 0, -1, 0, 842], width: 595, height: 842 };
    // DrawOPS: 0 moveTo, 1 lineTo. A rule from x=34 to x=561 at PDF y=700.
    const operatorList = {
      fnArray: [91],
      argsArray: [[20, [new Float32Array([0, 34, 700, 1, 561, 700])], null]],
    };
    const rules = detectHorizontalRules(fakePdfjs, operatorList, viewport);
    expect(rules).toEqual([700]);

    const { blocks } = buildTextBlocks([
      line("SKILLS", 34, 712, 60, 11),
      line("Security: SOC Operations and threat hunting.", 34, 694, 300, 10),
    ], 595, rules);
    expect(blocks[0]).toMatchObject({ kind: "heading", ruleBelow: true });
    expect(blocks[1]).toMatchObject({ kind: "paragraph" });
  });

  it("ignores short lines and page-edge borders when detecting rules", () => {
    const fakePdfjs = { OPS: { constructPath: 91 } } as unknown as Parameters<typeof detectHorizontalRules>[0];
    const viewport = { transform: [1, 0, 0, -1, 0, 842], width: 595, height: 842 };
    const operatorList = {
      fnArray: [91, 91, 91],
      argsArray: [
        [20, [new Float32Array([0, 34, 700, 1, 120, 700])], null], // short underline
        [20, [new Float32Array([0, 0, 841.9, 1, 595, 841.9])], null], // page top border
        [20, [new Float32Array([0, 34, 400, 1, 561, 400])], null], // real rule
      ],
    };
    expect(detectHorizontalRules(fakePdfjs, operatorList, viewport)).toEqual([400]);
  });

  it("only marks a table as bordered when vertical rules cross its own rows", () => {
    const fakePdfjs = { OPS: { constructPath: 91 } } as unknown as Parameters<typeof detectVerticalRules>[0];
    const horizontalOnly = {
      fnArray: [91],
      argsArray: [[20, [new Float32Array([0, 34, 700, 1, 561, 700])], null]],
    };
    expect(detectVerticalRules(fakePdfjs, horizontalOnly)).toEqual([]);

    const withColumns = {
      fnArray: [91, 91],
      argsArray: [
        [20, [new Float32Array([0, 200, 700, 1, 200, 400])], null],
        [20, [new Float32Array([0, 400, 700, 1, 400, 400])], null],
      ],
    };
    const rules = detectVerticalRules(fakePdfjs, withColumns);
    expect(rules).toHaveLength(2);

    // A table spanning y 400..700 with those two rules inside it is bordered.
    expect(tableHasBorders({ x: 34, y: 700, width: 527, height: 300 }, rules)).toBe(true);
    // A table elsewhere on the page is not.
    expect(tableHasBorders({ x: 34, y: 300, width: 527, height: 60 }, rules)).toBe(false);
    // One rule alone is not a grid.
    expect(tableHasBorders({ x: 34, y: 700, width: 527, height: 300 }, rules.slice(0, 1))).toBe(false);
  });
});
