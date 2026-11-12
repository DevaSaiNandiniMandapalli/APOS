import { describe, expect, it } from "vitest";
import { buildPdfHtml } from "./pdf-html";
import { validateHtmlOutput } from "./conversion-engine";

const encode = (value: string) => new TextEncoder().encode(value);

describe("buildPdfHtml", () => {
  it("keeps pictures between the paragraphs that surround them", () => {
    const html = buildPdfHtml("Report", [
      {
        page: 1,
        blocks: [
          { kind: "text", text: "Before the picture" },
          { kind: "image", dataUrl: "data:image/jpeg;base64,AAAA", width: 40, height: 30 },
          { kind: "text", text: "After the picture" },
        ],
      },
      { page: 2, blocks: [{ kind: "text", text: "Page two text" }] },
    ]);
    expect(html).toMatch(/^<!doctype html><html lang="en">/);
    expect(html).toContain('<section class="page" id="page-1"');
    expect(html.indexOf("Before the picture")).toBeLessThan(html.indexOf("<img "));
    expect(html.indexOf("<img ")).toBeLessThan(html.indexOf("After the picture"));
    expect(html).toContain('width="40" height="30"');
    expect(validateHtmlOutput(encode(html))).toBeUndefined();
  });

  it("escapes markup that came from the PDF text", () => {
    const html = buildPdfHtml("Report", [{ page: 1, blocks: [{ kind: "text", text: "<script>alert(1)</script>" }] }]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(validateHtmlOutput(encode(html))).toBeUndefined();
  });
});

describe("validateHtmlOutput", () => {
  it("rejects script tags", () => {
    expect(() => validateHtmlOutput(encode('<!doctype html><html lang="en"><body><main><script>x()</script></main></body></html>'))).toThrow(/structure validation/);
  });
});
