import { describe, expect, it } from "vitest";
import { assertImageWorkBounds, checkInputLimits, PDF_IMAGE_LIMITS, safeFileStem, selectedImagePages, validateRenderedImage } from "./pdf-images";

describe("PDF image export validation and resource limits", () => {
  it("selects page ranges in the requested order", () => {
    expect(selectedImagePages("3,1-2", 3)).toEqual([3, 1, 2]);
  });
  it("rejects empty, invalid, overlapping, out-of-range and over-count page selections", () => {
    expect(() => selectedImagePages("", 3)).toThrow();
    expect(() => selectedImagePages("1,1", 3)).toThrow();
    expect(() => selectedImagePages("4", 3)).toThrow();
    expect(() => selectedImagePages(Array.from({ length: 21 }, (_, index) => String(index + 1)).join(","), 21)).toThrow("no more than 20 pages");
  });
  it("checks PNG and JPEG signatures", () => {
    expect(() => validateRenderedImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "png")).not.toThrow();
    expect(() => validateRenderedImage(Uint8Array.from([0xff, 0xd8, 0xff]), "jpeg")).not.toThrow();
    expect(() => validateRenderedImage(new Uint8Array([1, 2, 3]), "png")).toThrow();
  });
  it("enforces file, per-page and aggregate pixel limits", () => {
    expect(() => checkInputLimits(0)).toThrow();
    expect(() => checkInputLimits(51 * 1024 * 1024)).toThrow();
    expect(assertImageWorkBounds(1000, 1000, 0)).toBe(1_000_000);
    expect(() => assertImageWorkBounds(4000, 4000, 0)).toThrow();
    expect(() => assertImageWorkBounds(2000, 2000, PDF_IMAGE_LIMITS.totalPixels - 1)).toThrow();
  });
  it("generates safe stems from user filenames", () => {
    expect(safeFileStem("../private:report.pdf")).toBe("..-private-report");
    expect(safeFileStem(".pdf")).toBe("document");
  });
});
