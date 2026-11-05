import { describe, expect, it } from "vitest";
import { unzipSync, strToU8 } from "fflate";
import { buildAgentDocx, blocksToPlainText, parseMarkdownBlocks } from "./agent-docx";
import { readDocxParagraphs } from "./office-formats";

const SAMPLE = `# Service agreement

The client pays **1200 USD** monthly.

## Charges

| Item | Amount |
| --- | --- |
| Monthly fee | 1200 |
| Late interest | 2% |

- Notice period is 60 days
- Reports are due by the 5th

1. Review the draft
2. Sign and return`;

describe("markdown blocks", () => {
  it("parses headings, paragraphs, tables and lists", () => {
    const blocks = parseMarkdownBlocks(SAMPLE);
    expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "heading", "table", "bullet", "numbered"]);
    const table = blocks[3];
    expect(table.type === "table" && table.rows).toEqual([["Item", "Amount"], ["Monthly fee", "1200"], ["Late interest", "2%"]]);
  });

  it("drops markdown emphasis characters", () => {
    const blocks = parseMarkdownBlocks(SAMPLE);
    expect(blocks[1]).toEqual({ type: "paragraph", text: "The client pays 1200 USD monthly." });
  });

  it("renders a readable plain-text draft", () => {
    const plain = blocksToPlainText(parseMarkdownBlocks(SAMPLE));
    expect(plain).toContain("Service agreement");
    expect(plain).toContain("1. Review the draft");
  });

  it("ignores an empty response", () => {
    expect(parseMarkdownBlocks("\n\n  \n")).toEqual([]);
  });
});

describe("agent docx", () => {
  it("writes a Word file containing every block", () => {
    const bytes = buildAgentDocx(SAMPLE, "Agreement");
    const xml = new TextDecoder().decode(unzipSync(bytes)["word/document.xml"]);
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("Monthly fee");
    expect(readDocxParagraphs(bytes)).toContain("Service agreement");
  });

  it("keeps working without any content", () => {
    const bytes = buildAgentDocx("", "Empty");
    expect(new TextDecoder().decode(bytes.slice(0, 2))).toBe("PK");
  });
});
