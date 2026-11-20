import { describe, expect, it } from "vitest";
import { buildPdfMarkdown, type HtmlPage } from "./pdf-html";

function page(blocks: HtmlPage["blocks"], pageNumber = 1): HtmlPage {
  return { page: pageNumber, width: 595, height: 842, blocks };
}

describe("buildPdfMarkdown", () => {
  it("renders headings, paragraphs, tables and page labels", () => {
    const markdown = buildPdfMarkdown("Quarterly report", [
      page([
        { kind: "heading", text: "Results", level: 2 },
        { kind: "text", text: "Revenue grew *sharply*." },
        { kind: "table", rows: [["Region", "Revenue"], ["North", "48000"]], header: true },
      ]),
    ]);
    expect(markdown).toContain("# Quarterly report");
    expect(markdown).toContain("## Page 1");
    expect(markdown).toContain("## Results");
    expect(markdown).toContain("\\*sharply\\*");
    expect(markdown).toContain("| Region | Revenue |");
    expect(markdown).toContain("| --- | --- |");
    expect(markdown).toContain("| North | 48000 |");
  });

  it("can omit page labels and tables", () => {
    const markdown = buildPdfMarkdown("Report", [
      page([
        { kind: "table", rows: [["A", "B"], ["1", "2"]], header: true },
        { kind: "text", text: "After table." },
      ]),
    ], { includePageLabels: false, includeTables: false });
    expect(markdown).not.toContain("## Page 1");
    expect(markdown).not.toContain("| ---");
    expect(markdown).toContain("A | B");
    expect(markdown).toContain("After table.");
  });

  it("includes images only when enabled", () => {
    const pages = [page([{ kind: "image", dataUrl: "data:image/png;base64,AAAA", width: 10, height: 10 }])];
    expect(buildPdfMarkdown("Report", pages)).not.toContain("![");
    expect(buildPdfMarkdown("Report", pages, { includeImages: true })).toContain("![Picture on page 1](data:image/png;base64,AAAA)");
  });

  it("marks empty pages honestly", () => {
    expect(buildPdfMarkdown("Report", [page([])])).toContain("_This page has no selectable text or pictures._");
  });
});
