import { describe, expect, it } from "vitest";
import { OCR_PDF_LIMITS, formatOcrPages, mergeOcrLines, parsePageSelection } from "./pdf-ocr";

describe("PDF OCR helpers", () => {
  it("defaults to the first pages of the document", () => {
    expect(parsePageSelection("", 3)).toEqual([1, 2, 3]);
    expect(parsePageSelection("", 40)).toHaveLength(OCR_PDF_LIMITS.maxPagesPerRun);
  });

  it("parses lists and ranges", () => {
    expect(parsePageSelection("3,1,1-2", 5)).toEqual([1, 2, 3]);
    expect(parsePageSelection("2-4", 10)).toEqual([2, 3, 4]);
  });

  it("clamps ranges to the document", () => {
    expect(parsePageSelection("4-99", 5)).toEqual([4, 5]);
  });

  it("rejects invalid selections", () => {
    expect(() => parsePageSelection("abc", 5)).toThrow('"abc" is not a page number or range.');
    expect(() => parsePageSelection("9", 5)).toThrow("outside this document");
    expect(() => parsePageSelection("3-1", 5)).toThrow("Invalid page range");
    expect(() => parsePageSelection("1-25", 50)).toThrow("at most 20 pages");
  });

  it("joins pages with markers and notes empty pages", () => {
    expect(formatOcrPages([{ page: 1, text: "Hello \n" }, { page: 2, text: "  " }])).toBe(
      "--- Page 1 ---\nHello\n\n--- Page 2 ---\n(no text recognised)",
    );
  });

  it("tidies recognised text", () => {
    expect(mergeOcrLines("a  \r\n\r\n\r\nb")).toBe("a\n\nb");
  });
});
