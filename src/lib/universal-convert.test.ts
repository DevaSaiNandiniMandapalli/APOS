import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { canonicalTarget, detectKind, planConversion } from "./universal-convert";
import { buildDocx } from "./office-formats";

describe("target parsing", () => {
  it("understands plain language", () => {
    expect(canonicalTarget("convert to PDF")).toBe("pdf");
    expect(canonicalTarget("make it a word file")).toBe("docx");
    expect(canonicalTarget("Change to JPG")).toBe("jpeg");
    expect(canonicalTarget("turn into excel")).toBe("xlsx");
    expect(canonicalTarget("png")).toBe("png");
    expect(canonicalTarget("Extract the text")).toBe("txt");
  });

  it("rejects a request with no format", () => {
    expect(canonicalTarget("do something nice")).toBeNull();
  });
});

describe("format detection", () => {
  it("uses file signatures", () => {
    expect(detectKind("a.pdf", new TextEncoder().encode("%PDF-1.7"))).toBe("pdf");
    expect(detectKind("a.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(detectKind("a.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
  });

  it("trusts the extension inside a zip container", () => {
    expect(detectKind("report.docx", new Uint8Array([0x50, 0x4b, 3, 4]))).toBe("docx");
    expect(detectKind("notes.txt", new TextEncoder().encode("hello"))).toBe("text");
  });
});

describe("route planning", () => {
  it("accepts the paths we implement", () => {
    expect(planConversion("pdf", "docx").supported).toBe(true);
    expect(planConversion("docx", "pdf").supported).toBe(true);
    expect(planConversion("csv", "xlsx").supported).toBe(true);
    expect(planConversion("jpeg", "png").supported).toBe(true);
    expect(planConversion("png", "pdf").supported).toBe(true);
    expect(planConversion("text", "pdf").supported).toBe(true);
  });

  it("refuses honestly what it cannot do", () => {
    const plan = planConversion("pdf", "pptx");
    expect(plan.supported).toBe(false);
    if (!plan.supported) expect(plan.reason).toContain("not supported yet");
    expect(planConversion("pdf", "pdf").supported).toBe(false);
  });
});

describe("document bytes", () => {
  it("produces a docx package", () => {
    const bytes = buildDocx(["Hello"], "T");
    expect(Object.keys(unzipSync(bytes))).toContain("word/document.xml");
  });
});
