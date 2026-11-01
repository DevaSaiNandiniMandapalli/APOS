import { describe, expect, it } from "vitest";
import { decodeTiffToRgba } from "./tiff-image";

type FixtureOptions = {
  width: number;
  height: number;
  pixels: number[];
  samples?: number;
  photometric?: number;
  bits?: number;
  littleEndian?: boolean;
};

function makeTiff(options: FixtureOptions): Uint8Array {
  const {
    width,
    height,
    pixels,
    samples = 1,
    photometric = 1,
    bits = 8,
    littleEndian = true,
  } = options;

  const entries = [
    { tag: 256, type: 4, values: [width] },
    { tag: 257, type: 4, values: [height] },
    { tag: 258, type: 3, values: Array(samples).fill(bits) },
    { tag: 259, type: 3, values: [1] },
    { tag: 262, type: 3, values: [photometric] },
    { tag: 273, type: 4, values: [0] },
    { tag: 277, type: 3, values: [samples] },
    { tag: 278, type: 4, values: [height] },
    { tag: 279, type: 4, values: [pixels.length] },
    { tag: 284, type: 3, values: [1] },
  ] satisfies { tag: number; type: 3 | 4; values: number[] }[];

  entries.sort((a, b) => a.tag - b.tag);

  const ifdEnd = 8 + 2 + entries.length * 12 + 4;
  let extraLength = 0;

  for (const entry of entries) {
    const byteLength = entry.values.length * (entry.type === 3 ? 2 : 4);
    if (byteLength > 4) extraLength += byteLength;
  }

  const pixelOffset = ifdEnd + extraLength;
  const bytes = new Uint8Array(pixelOffset + pixels.length);
  const view = new DataView(bytes.buffer);

  bytes[0] = littleEndian ? 0x49 : 0x4d;
  bytes[1] = littleEndian ? 0x49 : 0x4d;

  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, 8, littleEndian);
  view.setUint16(8, entries.length, littleEndian);

  let extraOffset = ifdEnd;
  let position = 10;

  for (const entry of entries) {
    const byteLength = entry.values.length * (entry.type === 3 ? 2 : 4);
    const values = [...entry.values];

    if (entry.tag === 273) values[0] = pixelOffset;
    if (entry.tag === 279) values[0] = pixels.length;

    view.setUint16(position, entry.tag, littleEndian);
    view.setUint16(position + 2, entry.type, littleEndian);
    view.setUint32(position + 4, values.length, littleEndian);

    const valuePosition = byteLength > 4 ? extraOffset : position + 8;

    if (byteLength > 4) {
      view.setUint32(position + 8, extraOffset, littleEndian);
      extraOffset += byteLength;
    }

    values.forEach((value, index) => {
      if (entry.type === 3) {
        view.setUint16(valuePosition + index * 2, value, littleEndian);
      } else {
        view.setUint32(valuePosition + index * 4, value, littleEndian);
      }
    });

    position += 12;
  }

  view.setUint32(position, 0, littleEndian);
  bytes.set(pixels, pixelOffset);

  return bytes;
}

describe("TIFF image decoding", () => {
  it("decodes 8-bit grayscale pixels into opaque RGBA", () => {
    const bytes = makeTiff({
      width: 2,
      height: 1,
      pixels: [10, 200],
    });

    const result = decodeTiffToRgba(bytes, new AbortController().signal);

    expect(result.width).toBe(2);
    expect(result.height).toBe(1);
    expect(Array.from(result.pixels)).toEqual([
      10, 10, 10, 255,
      200, 200, 200, 255,
    ]);
  });

  it("preserves RGB channels", () => {
    const bytes = makeTiff({
      width: 1,
      height: 1,
      samples: 3,
      photometric: 2,
      pixels: [25, 120, 240],
    });

    const result = decodeTiffToRgba(bytes, new AbortController().signal);

    expect(Array.from(result.pixels)).toEqual([25, 120, 240, 255]);
  });

  it("handles WhiteIsZero grayscale inversion", () => {
    const bytes = makeTiff({
      width: 2,
      height: 1,
      photometric: 0,
      pixels: [0, 255],
    });

    const result = decodeTiffToRgba(bytes, new AbortController().signal);

    expect(Array.from(result.pixels)).toEqual([
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);
  });

  it("decodes big-endian TIFF", () => {
    const bytes = makeTiff({
      width: 2,
      height: 1,
      pixels: [40, 180],
      littleEndian: false,
    });

    const result = decodeTiffToRgba(bytes, new AbortController().signal);

    expect(Array.from(result.pixels)).toEqual([
      40, 40, 40, 255,
      180, 180, 180, 255,
    ]);
  });

  it("rejects unsupported 16-bit images before pixel decoding", () => {
    const bytes = makeTiff({
      width: 1,
      height: 1,
      pixels: [0, 0],
      bits: 16,
    });

    expect(() =>
      decodeTiffToRgba(bytes, new AbortController().signal),
    ).toThrow("Only 8-bit TIFF images are supported.");
  });

  it("rejects images exceeding the pixel limit before pixel decoding", () => {
    const bytes = makeTiff({
      width: 5000,
      height: 4000,
      pixels: [],
    });

    expect(() =>
      decodeTiffToRgba(bytes, new AbortController().signal),
    ).toThrow("The TIFF dimensions exceed the supported limits.");
  });

  it("rejects malformed TIFF data", () => {
    const bytes = new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]);

    expect(() =>
      decodeTiffToRgba(bytes, new AbortController().signal),
    ).toThrow();
  });

  it("rejects non-TIFF data", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    expect(() =>
      decodeTiffToRgba(bytes, new AbortController().signal),
    ).toThrow("The file is not a supported classic TIFF image.");
  });

  it("rejects cancellation before decoding", () => {
    const controller = new AbortController();
    controller.abort();

    const bytes = makeTiff({
      width: 1,
      height: 1,
      pixels: [100],
    });

    expect(() =>
      decodeTiffToRgba(bytes, controller.signal),
    ).toThrow("TIFF conversion was cancelled.");
  });
});
