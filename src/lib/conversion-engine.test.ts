import { describe, expect, it } from "vitest";
import { CONVERSION_LIMITS, conversionCapabilities, findConversionCapability, identifyInputFormat, runBoundedQueue, safeOutputFilename, validateConversionInput, validateConversionOutput, validateHtmlOutput, validatePlainTextOutput } from "./conversion-engine";

describe("conversion engine declarations and validation", () => {
  it("declares PDF text/HTML and all nine supported image conversion capabilities", () => {
    expect(conversionCapabilities.map(({ id, inputFormat, outputFormat, convert }) => ({ id, inputFormat, outputFormat, hasExecutor: typeof convert === "function" }))).toEqual([
      { id: "pdf-to-text", inputFormat: "pdf", outputFormat: "txt", hasExecutor: true },
      { id: "pdf-to-html", inputFormat: "pdf", outputFormat: "html", hasExecutor: true },
      { id: "png-to-jpeg", inputFormat: "png", outputFormat: "jpeg", hasExecutor: true },
      { id: "png-to-webp", inputFormat: "png", outputFormat: "webp", hasExecutor: true },
      { id: "jpeg-to-png", inputFormat: "jpeg", outputFormat: "png", hasExecutor: true },
      { id: "jpeg-to-webp", inputFormat: "jpeg", outputFormat: "webp", hasExecutor: true },
      { id: "webp-to-png", inputFormat: "webp", outputFormat: "png", hasExecutor: true },
      { id: "webp-to-jpeg", inputFormat: "webp", outputFormat: "jpeg", hasExecutor: true },
      { id: "tiff-to-png", inputFormat: "tiff", outputFormat: "png", hasExecutor: true },
      { id: "tiff-to-jpeg", inputFormat: "tiff", outputFormat: "jpeg", hasExecutor: true },
      { id: "tiff-to-webp", inputFormat: "tiff", outputFormat: "webp", hasExecutor: true },
    ]);
    expect(findConversionCapability("pdf", "txt")?.maxBatchFiles).toBe(20);
    expect(findConversionCapability("pdf", "html")?.outputExtension).toBe("html");
    expect(findConversionCapability("png", "jpeg")?.outputMediaType).toBe("image/jpeg");
    expect(findConversionCapability("webp", "png")?.outputExtension).toBe("png");
    expect(findConversionCapability("png", "png")).toBeUndefined();
  });

  it("identifies inputs from signatures instead of file extensions", () => {
    expect(identifyInputFormat(new TextEncoder().encode("%PDF-1.7"))).toBe("pdf");
    expect(identifyInputFormat(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toBe("png");
    expect(identifyInputFormat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(identifyInputFormat(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("webp");
    expect(identifyInputFormat(Uint8Array.from([0x49, 0x49, 42, 0]))).toBe("tiff");
    expect(identifyInputFormat(new TextEncoder().encode("not a document"))).toBe("unknown");
  });

  it("rejects empty, oversized and unsupported input files", () => {
    const converter = conversionCapabilities[0];
    expect(() => validateConversionInput({ name: "empty.pdf", size: 0 }, "pdf", converter)).toThrow("empty");
    expect(() => validateConversionInput({ name: "large.pdf", size: converter.maxFileBytes + 1 }, "pdf", converter)).toThrow("up to 25.00 MB");
    expect(() => validateConversionInput({ name: "image.pdf", size: 100 }, "png", converter)).toThrow("signature identifies a PNG file");
    expect(() => validateConversionInput({ name: "report.pdf", size: 100 }, "unknown", converter)).toThrow("unsupported or unrecognized");
  });

  it("validates UTF-8 output and rejects invalid or oversized results", () => {
    const converter = conversionCapabilities[0];
    expect(() => validateConversionOutput(new TextEncoder().encode("hello"), converter)).not.toThrow();
    expect(() => validatePlainTextOutput(Uint8Array.from([0xc3, 0x28]))).toThrow("UTF-8");
    expect(() => validateConversionOutput(new Uint8Array(CONVERSION_LIMITS.outputFileBytes + 1), converter)).toThrow("output limit");
  });

  it("checks HTML structure and refuses embedded active content", () => {
    const safe = new TextEncoder().encode("<!doctype html><html lang=\"en\"><body><main><pre>&lt;script&gt;</pre></main></body></html>");
    expect(() => validateHtmlOutput(safe)).not.toThrow();
    expect(() => validateHtmlOutput(new TextEncoder().encode("<!doctype html><html lang=\"en\"><body><main><pre><script>alert(1)</script></pre></main></body></html>"))).toThrow("structure validation");
  });

  it("resolves duplicate output names deterministically and strips unsafe path characters", () => {
    const names = new Set<string>();
    expect(safeOutputFilename("report.pdf", "report", "txt", names)).toBe("report.txt");
    expect(safeOutputFilename("report.pdf", "report", "txt", names)).toBe("report (2).txt");
    expect(safeOutputFilename("report.pdf", "../folder\\report", "txt", new Set())).toBe("report.txt");
    expect(() => safeOutputFilename("report.pdf", "report", "..", names)).toThrow("safe output extension");
  });

  it("runs queued items with bounded concurrency and stops taking new work on cancellation", async () => {
    let active = 0;
    let peak = 0;
    const controller = new AbortController();
    const started: number[] = [];
    await runBoundedQueue([0, 1, 2, 3, 4], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      started.push(item);
      await new Promise((resolve) => setTimeout(resolve, item === 0 ? 10 : 1));
      active -= 1;
      if (item === 1) controller.abort();
    }, controller.signal);
    expect(peak).toBe(2);
    expect(started).toEqual([0, 1]);
    await expect(runBoundedQueue([], 0, async () => undefined)).rejects.toThrow("between 1 and 8");
  });
});
