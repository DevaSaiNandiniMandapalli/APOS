import { describe, expect, it } from "vitest";
import {
  PAGE_SIZE_POINTS,
  hexToRgb,
  imagePlacement,
  marginPoints,
  pageDimensions,
  safeImagesPdfName,
  validateImageDimensions,
  validateImagesToPdfSettings,
  type ImagesToPdfSettings,
} from "./images-to-pdf";

const base: ImagesToPdfSettings = {
  pageSize: "a4",
  orientation: "auto",
  margin: "none",
  customMarginMm: 10,
  customWidthMm: 210,
  customHeightMm: 297,
  fit: "fit",
  background: "#ffffff",
  compression: "original",
  quality: 0.85,
  outputName: "images.pdf",
};

describe("images to PDF page layout", () => {
  it("uses the standard page sizes and follows image orientation in auto mode", () => {
    expect(pageDimensions(base, 1200, 800)).toEqual({ width: PAGE_SIZE_POINTS.a4.height, height: PAGE_SIZE_POINTS.a4.width });
    expect(pageDimensions({ ...base, orientation: "portrait" }, 1200, 800)).toEqual({ width: PAGE_SIZE_POINTS.a4.width, height: PAGE_SIZE_POINTS.a4.height });
    expect(pageDimensions({ ...base, pageSize: "a3" }, 800, 1200)).toEqual({ width: PAGE_SIZE_POINTS.a3.width, height: PAGE_SIZE_POINTS.a3.height });
    expect(pageDimensions({ ...base, pageSize: "image" }, 320, 200)).toEqual({ width: 320, height: 200 });
  });

  it("preserves the aspect ratio when fitting and centres the image", () => {
    const placement = imagePlacement(1000, 500, 595.28, 841.89, 36, "fit");
    expect(placement.width / placement.height).toBeCloseTo(2, 6);
    expect(placement.x).toBeGreaterThanOrEqual(36);
    expect(placement.y).toBeGreaterThan(36);
    expect(placement.width).toBeLessThanOrEqual(595.28 - 72);
    expect(placement.height).toBeLessThanOrEqual(841.89 - 72);
  });

  it("fills the content area by covering it and clips beyond the page", () => {
    const placement = imagePlacement(1000, 500, 595.28, 841.89, 36, "fill");
    expect(placement.width / placement.height).toBeCloseTo(2, 6);
    expect(placement.width).toBeGreaterThanOrEqual(595.28 - 72);
    expect(placement.x).toBeLessThan(36);
  });

  it("supports original-size and centred placement at 96 DPI", () => {
    const original = imagePlacement(400, 200, 595.28, 841.89, 36, "original");
    expect(original.width).toBe(300);
    expect(original.height).toBe(150);
    const centered = imagePlacement(400, 200, 595.28, 841.89, 36, "center");
    expect(centered.x).toBeGreaterThan(original.x);
    expect(centered.y).toBeLessThan(original.y);
  });

  it("converts margins and validates custom settings", () => {
    expect(marginPoints({ margin: "none", customMarginMm: 10 })).toBe(0);
    expect(marginPoints({ margin: "custom", customMarginMm: 10 })).toBeCloseTo(28.346, 2);
    expect(() => validateImagesToPdfSettings({ ...base, background: "red" })).toThrow("background colour");
    expect(() => validateImagesToPdfSettings({ ...base, quality: 2 })).toThrow("JPEG quality");
    expect(() => validateImagesToPdfSettings({ ...base, pageSize: "custom", customWidthMm: 2 })).toThrow("Custom page dimensions");
    expect(hexToRgb("#ff8000")).toEqual([1, 128 / 255, 0]);
  });

  it("rejects unsafe output names and checks pixel limits", () => {
    expect(safeImagesPdfName("../bad:name.pdf")).toBe("bad-name.pdf");
    expect(safeImagesPdfName("")).toBe("images.pdf");
    expect(() => validateImageDimensions(0, 10)).toThrow();
    expect(() => validateImageDimensions(12001, 10)).toThrow("12,000-pixel");
    expect(() => validateImageDimensions(8000, 6000)).toThrow("40-megapixel");
  });
});
