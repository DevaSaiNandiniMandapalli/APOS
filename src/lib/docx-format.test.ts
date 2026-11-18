import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildDocxDocument, splitListMarker, validateDocxDocument, type DocxContentBlock } from "./office-formats";

function documentXml(blocks: DocxContentBlock[]) {
  const bytes = buildDocxDocument(blocks, "Test");
  const entries = unzipSync(bytes);
  return {
    xml: new TextDecoder().decode(entries["word/document.xml"]),
    entries,
  };
}

describe("splitListMarker", () => {
  it("strips bullet markers and reports them as unordered", () => {
    expect(splitListMarker("\u2022 Led workshops")).toEqual({ text: "Led workshops", ordered: false });
    expect(splitListMarker("- Hyphen bullet")).toEqual({ text: "Hyphen bullet", ordered: false });
    expect(splitListMarker("* Star bullet")).toEqual({ text: "Star bullet", ordered: false });
  });

  it("strips numeric markers and reports them as ordered", () => {
    expect(splitListMarker("1. First item")).toEqual({ text: "First item", ordered: true });
    expect(splitListMarker("12) Twelfth item")).toEqual({ text: "Twelfth item", ordered: true });
    expect(splitListMarker("a. Lettered item")).toEqual({ text: "Lettered item", ordered: true });
  });

  it("leaves plain text alone", () => {
    expect(splitListMarker("Just a sentence.")).toEqual({ text: "Just a sentence.", ordered: false });
  });
});

describe("Word document structure", () => {
  it("turns list blocks into real Word numbering instead of literal bullets", () => {
    const { xml, entries } = documentXml([
      { kind: "list", text: "\u2022 Led workshops" },
      { kind: "list", text: "1. First item" },
    ]);
    expect(xml).toContain("<w:numPr>");
    expect(xml).toContain('<w:numId w:val="1"/>');
    expect(xml).toContain('<w:numId w:val="2"/>');
    expect(xml).not.toContain("\u2022 Led workshops");
    expect(entries["word/numbering.xml"]).toBeTruthy();
    const numbering = new TextDecoder().decode(entries["word/numbering.xml"]);
    expect(numbering).toContain('w:numFmt w:val="bullet"');
    expect(numbering).toContain('w:numFmt w:val="decimal"');
  });

  it("does not invent table borders unless asked", () => {
    const plain = documentXml([{ kind: "table", rows: [["A", "B"], ["1", "2"]] }]).xml;
    expect(plain).toContain('<w:top w:val="none"');
    expect(plain).not.toContain('w:val="single" w:sz="4"');

    const bordered = documentXml([{ kind: "table", rows: [["A", "B"]], bordered: true }]).xml;
    expect(bordered).toContain('w:val="single" w:sz="4"');
  });

  it("draws a rule under a heading only when the source had one", () => {
    const withRule = documentXml([{ kind: "heading", text: "SKILLS", level: 3, ruleBelow: true }]).xml;
    expect(withRule).toContain("<w:pBdr>");
    expect(withRule).toContain('w:val="single" w:sz="6"');

    const withoutRule = documentXml([{ kind: "heading", text: "SKILLS", level: 3 }]).xml;
    expect(withoutRule).not.toContain("<w:pBdr>");
  });

  it("keeps the generated package valid", () => {
    const bytes = buildDocxDocument([
      { kind: "heading", text: "Title", level: 1 },
      { kind: "paragraph", text: "Body text.", fontSize: 10 },
      { kind: "list", text: "\u2022 Bullet" },
      { kind: "table", rows: [["A", "B"]] },
    ], "Test");
    expect(() => validateDocxDocument(bytes)).not.toThrow();
  });
});
