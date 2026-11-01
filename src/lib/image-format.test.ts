import { describe, expect, it } from "vitest";
import { identifyImageFormat, imageFormatSignature, readImageDimensions } from "./image-format";

function pngBytes(width: number, height: number) {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, width, 0, 0, 0, height]);
  return bytes;
}

function jpegBytes() {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08, 0x00, 0x30, 0x00, 0x18, 0x03]);
  return bytes;
}

function webpBytes() {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0, 0, 0, 0], 4);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  bytes.set([0, 0, 0, 10], 16);
  bytes[24] = 99; bytes[25] = 0; bytes[26] = 0;
  bytes[27] = 49; bytes[28] = 0; bytes[29] = 0;
  return bytes;
}

function tiffBytes() {
  const bytes = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 8]);
  return bytes;
}

describe("image format helpers", () => {
  it("identifies inputs from signatures instead of trusting names", () => {
    expect(identifyImageFormat(pngBytes(10, 20))).toBe("png");
    expect(identifyImageFormat(jpegBytes())).toBe("jpeg");
    expect(identifyImageFormat(webpBytes())).toBe("webp");
    expect(identifyImageFormat(tiffBytes())).toBe("tiff");
    expect(identifyImageFormat(new TextEncoder().encode("not an image"))).toBe("unknown");
  });

  it("reads PNG dimensions from the IHDR header", () => {
    const dimensions = readImageDimensions(pngBytes(10, 20), "png");
    expect(dimensions).toEqual({ width: 10, height: 20 });
  });

  it("reads JPEG dimensions from the frame header", () => {
    const dimensions = readImageDimensions(jpegBytes(), "jpeg");
    expect(dimensions).toEqual({ width: 24, height: 48 });
  });

  it("reads WEBP dimensions from the extended format header", () => {
    const dimensions = readImageDimensions(webpBytes(), "webp");
    expect(dimensions).toEqual({ width: 100, height: 50 });
  });

  it("validates re-encoded image signatures", () => {
    expect(imageFormatSignature(pngBytes(10, 20), "png")).toBe(true);
    expect(imageFormatSignature(jpegBytes(), "jpeg")).toBe(true);
    expect(imageFormatSignature(webpBytes(), "webp")).toBe(true);
    expect(imageFormatSignature(pngBytes(10, 20), "jpeg")).toBe(false);
  });
});
