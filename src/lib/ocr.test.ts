import { describe, expect, it } from "vitest";
import { normalizeOcrText, validateOcrFile } from "./ocr";

describe("validateOcrFile", () => {
  it("accepts supported images", () => {
    expect(validateOcrFile({ name: "scan.png", type: "image/png", size: 1000 })).toBeNull();
    expect(validateOcrFile({ name: "photo.JPG", type: "", size: 1000 })).toBeNull();
  });
  it("rejects other files", () => {
    expect(validateOcrFile({ name: "doc.pdf", type: "application/pdf", size: 1000 })).toBeTruthy();
    expect(validateOcrFile({ name: "", type: "", size: 0 })).toBeTruthy();
  });
  it("rejects oversized files", () => {
    expect(validateOcrFile({ name: "big.png", type: "image/png", size: 16 * 1024 * 1024 })).toBeTruthy();
  });
});

describe("normalizeOcrText", () => {
  it("normalizes newlines and trims", () => {
    expect(normalizeOcrText("  hello  \r\n\r\n\r\n\r\nworld\t \n")).toBe("hello\n\nworld");
  });
});
