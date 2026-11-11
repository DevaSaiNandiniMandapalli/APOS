import { describe, expect, it } from "vitest";
import { buildDocxRich, readDocxBlocks } from "./office-formats";

function solidPng(width: number, height: number): Uint8Array {
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    new DataView(out.buffer).setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = 20;
      raw[o + 1] = 140;
      raw[o + 2] = 220;
    }
  }
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", raw), chunk("IEND", new Uint8Array())];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { png.set(part, offset); offset += part.length; }
  return png;
}

describe("docx image round trip", () => {
  it("writes a picture into word/media and reads it back in order", () => {
    const png = solidPng(8, 6);
    const docx = buildDocxRich(
      [
        { kind: "text", text: "Quarterly report" },
        { kind: "image", bytes: png, format: "png", width: 8, height: 6 },
        { kind: "text", text: "Total sold: 42" },
      ],
      "Report",
    );
    const blocks = readDocxBlocks(docx);
    expect(blocks.map((block) => block.kind)).toEqual(["text", "image", "text"]);
    expect(blocks[0]).toMatchObject({ kind: "text", text: "Quarterly report" });
    expect(blocks[1]).toMatchObject({ kind: "image", format: "png", width: 8, height: 6 });
    expect(blocks[2]).toMatchObject({ kind: "text", text: "Total sold: 42" });
  });
});
