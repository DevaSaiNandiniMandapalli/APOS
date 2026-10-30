import type { ConversionFormat } from "./conversion-engine";

function ascii(bytes: Uint8Array, start: number, count: number) { return String.fromCharCode(...bytes.subarray(start, start + count)); }
function readBig16(bytes: Uint8Array, offset: number) { return (bytes[offset] << 8) | bytes[offset + 1]; }
function readLittle24(bytes: Uint8Array, offset: number) { return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16); }

export function identifyImageFormat(bytes: Uint8Array): ConversionFormat {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG" && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  if (bytes.length >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a))) return "tiff";
  return "unknown";
}

export type ImageDimensions = { width: number; height: number };

export function readImageDimensions(bytes: Uint8Array, format: ConversionFormat): ImageDimensions {
  let dimensions: ImageDimensions | undefined;
  if (format === "png" && bytes.length >= 24) dimensions = { width: (bytes[16] * 0x1000000) + (bytes[17] << 16) + (bytes[18] << 8) + bytes[19], height: (bytes[20] * 0x1000000) + (bytes[21] << 16) + (bytes[22] << 8) + bytes[23] };
  else if (format === "jpeg") dimensions = readJpegDimensions(bytes);
  else if (format === "webp") dimensions = readWebpDimensions(bytes);
  if (!dimensions || !Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height) || dimensions.width < 1 || dimensions.height < 1) throw new Error("The image dimensions could not be read from its format header.");
  return dimensions;
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda || marker === undefined) return undefined;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) return undefined;
    const segmentLength = readBig16(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return undefined;
    if (frameMarkers.has(marker)) {
      if (segmentLength < 7) return undefined;
      return { height: readBig16(bytes, offset + 3), width: readBig16(bytes, offset + 5) };
    }
    offset += segmentLength;
  }
  return undefined;
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return undefined;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") return { width: readLittle24(bytes, 24) + 1, height: readLittle24(bytes, 27) + 1 };
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
    const height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
    return { width, height };
  }
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
  return undefined;
}

export function imageFormatSignature(bytes: Uint8Array, format: ConversionFormat) {
  if (format === "png") return bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG" && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
  if (format === "jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (format === "webp") return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
  return false;
}
