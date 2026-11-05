import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  buildExcerpt,
  decodeXmlEntities,
  docxXmlToText,
  isSupportedDocumentName,
  normalizeExtractedText,
} from "./document-text";

describe("document text extraction helpers", () => {
  it("turns WordprocessingML into readable text", () => {
    const xml = "<w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space=\"preserve\"> world</w:t></w:r></w:p><w:p><w:r><w:t>Second line &amp; more</w:t></w:r></w:p></w:body>";
    expect(docxXmlToText(xml)).toBe("Hello world\nSecond line & more");
  });

  it("decodes numeric and named XML entities", () => {
    expect(decodeXmlEntities("A &amp; B &#8212; C &#x2014; &lt;tag&gt;")).toBe("A & B — C — <tag>");
  });

  it("normalises whitespace and blank lines", () => {
    expect(normalizeExtractedText("a  \r\n\r\n\r\nb\t \n")).toBe("a\n\nb");
  });

  it("shortens long documents on a sentence or paragraph boundary", () => {
    const text = `${"Sentence one. ".repeat(50)}`;
    const { excerpt, truncated, totalCharacters } = buildExcerpt(text, 100);
    expect(truncated).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(100);
    expect(totalCharacters).toBe(text.trim().length);
    expect(excerpt.endsWith(".")).toBe(true);
  });

  it("keeps short documents intact", () => {
    expect(buildExcerpt("Short text.", 100)).toEqual({ excerpt: "Short text.", truncated: false, totalCharacters: 11 });
  });

  it("recognises supported document names", () => {
    expect(isSupportedDocumentName("a.pdf")).toBe(true);
    expect(isSupportedDocumentName("A.DOCX")).toBe(true);
    expect(isSupportedDocumentName("notes.md")).toBe(true);
    expect(isSupportedDocumentName("photo.png")).toBe(false);
  });

  it("produces a readable docx archive fixture", () => {
    const zip = zipSync({ "word/document.xml": strToU8("<w:p><w:t>Fixture</w:t></w:p>") });
    expect(zip.byteLength).toBeGreaterThan(0);
  });
});
