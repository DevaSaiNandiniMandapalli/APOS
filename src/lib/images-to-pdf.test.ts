import { describe, expect, it } from "vitest";
import { imageFormatFromSignature, validateImageBatch } from "./images-to-pdf";

describe("images to PDF validation", () => {
  it("enforces nonempty batches, count and combined byte limits", () => {
    expect(() => validateImageBatch([])).toThrow("at least one");
    expect(() => validateImageBatch([0])).toThrow("must not be empty");
    expect(() => validateImageBatch(Array(21).fill(1))).toThrow("no more than 20");
    expect(() => validateImageBatch([30 * 1024 * 1024, 21 * 1024 * 1024])).toThrow("no more than 50 MB");
    expect(() => validateImageBatch([100, 200])).not.toThrow();
  });
  it("detects PNG and JPEG signatures without trusting file names", () => {
    expect(imageFormatFromSignature(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe("png");
    expect(imageFormatFromSignature(Uint8Array.from([255, 216, 255, 0]))).toBe("jpeg");
    expect(imageFormatFromSignature(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
});
