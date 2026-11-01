import { decode } from "tiff";

export const TIFF_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxDimension: 12_000,
  maxPixels: 16_000_000,
} as const;

class TiffValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TiffValidationError";
  }
}

export type DecodedTiffImage = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException("TIFF conversion was cancelled.", "AbortError");
  }
}

function validateHeader(bytes: Uint8Array) {
  if (bytes.byteLength < 8) {
    throw new Error("The TIFF file is incomplete.");
  }

  if (bytes.byteLength > TIFF_LIMITS.maxFileBytes) {
    throw new Error("The TIFF file exceeds the 25 MiB input limit.");
  }

  const littleEndian =
    bytes[0] === 0x49 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x2a &&
    bytes[3] === 0;

  const bigEndian =
    bytes[0] === 0x4d &&
    bytes[1] === 0x4d &&
    bytes[2] === 0 &&
    bytes[3] === 0x2a;

  if (!littleEndian && !bigEndian) {
    throw new Error("The file is not a supported classic TIFF image. BigTIFF is not supported.");
  }
}

function validateMetadata(ifd: ReturnType<typeof decode>[number]) {
  const { width, height } = ifd;

  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > TIFF_LIMITS.maxDimension ||
    height > TIFF_LIMITS.maxDimension ||
    width * height > TIFF_LIMITS.maxPixels
  ) {
    throw new TiffValidationError("The TIFF dimensions exceed the supported limits.");
  }

  if (ifd.bitsPerSample !== 8) {
    throw new TiffValidationError("Only 8-bit TIFF images are supported.");
  }

  if (ifd.sampleFormat !== 1) {
    throw new TiffValidationError("Only unsigned integer TIFF samples are supported.");
  }

  if (ifd.type !== 0 && ifd.type !== 1 && ifd.type !== 2) {
    throw new TiffValidationError("Only grayscale and RGB TIFF images are supported. Palette and other color modes are not supported.");
  }

  const expectedSamples = ifd.type === 2 ? 3 : 1;

  if (ifd.samplesPerPixel !== expectedSamples) {
    throw new TiffValidationError("This TIFF channel layout is not supported. Alpha and extra channels are not supported.");
  }

  if (ifd.planarConfiguration !== 1) {
    throw new TiffValidationError("Planar TIFF images are not supported. Use chunky/interleaved pixel data.");
  }

  if (ifd.tiled) {
    throw new TiffValidationError("Tiled TIFF images are not supported.");
  }

  if (ifd.orientation !== undefined && ifd.orientation !== 1) {
    throw new TiffValidationError("Only TIFF images with standard orientation are supported.");
  }

  if (ifd.compression !== 1) {
    throw new TiffValidationError("Only uncompressed TIFF images are currently supported.");
  }

  if (ifd.predictor !== undefined && ifd.predictor !== 1 && ifd.predictor !== 2) {
    throw new TiffValidationError("This TIFF predictor is not supported.");
  }

  if (ifd.predictor === 2 && ifd.bitsPerSample !== 8) {
    throw new TiffValidationError("Horizontal TIFF prediction is supported only for 8-bit images.");
  }
}

export function decodeTiffToRgba(
  bytes: Uint8Array,
  signal: AbortSignal,
): DecodedTiffImage {
  checkCancelled(signal);
  validateHeader(bytes);

  let metadata: ReturnType<typeof decode>[number];

  try {
    const pages = decode(bytes, {
      ignoreImageData: true,
      pages: [0],
    });

    if (pages.length !== 1) {
      throw new Error("The TIFF file does not contain a readable first page.");
    }

    metadata = pages[0];
    validateMetadata(metadata);
  } catch (error) {
    if (error instanceof TiffValidationError) {
      throw error;
    }

    throw new Error(
      `The TIFF metadata could not be read: ${error instanceof Error ? error.message : "Invalid TIFF data."}`,
    );
  }

  checkCancelled(signal);

  let decoded: ReturnType<typeof decode>[number];

  try {
    const pages = decode(bytes, { pages: [0] });

    if (pages.length !== 1) {
      throw new Error("The TIFF first page could not be decoded.");
    }

    decoded = pages[0];
  } catch (error) {
    throw new Error(
      `The TIFF image could not be decoded: ${error instanceof Error ? error.message : "Invalid image data."}`,
    );
  }

  checkCancelled(signal);

  if (
    decoded.width !== metadata.width ||
    decoded.height !== metadata.height ||
    decoded.bitsPerSample !== metadata.bitsPerSample ||
    decoded.samplesPerPixel !== metadata.samplesPerPixel ||
    decoded.type !== metadata.type
  ) {
    throw new Error("The TIFF image data does not match its validated metadata.");
  }

  const sampleCount = decoded.width * decoded.height * decoded.samplesPerPixel;

  if (
    !(decoded.data instanceof Uint8Array) ||
    decoded.data.byteLength !== sampleCount
  ) {
    throw new Error("The decoded TIFF pixel data has an unexpected size or format.");
  }

  const pixelCount = decoded.width * decoded.height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  const grayscale = decoded.samplesPerPixel === 1;

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const source = pixel * decoded.samplesPerPixel;
    const target = pixel * 4;

    if (grayscale) {
      const value = decoded.data[source];
      rgba[target] = value;
      rgba[target + 1] = value;
      rgba[target + 2] = value;
    } else {
      rgba[target] = decoded.data[source];
      rgba[target + 1] = decoded.data[source + 1];
      rgba[target + 2] = decoded.data[source + 2];
    }

    rgba[target + 3] = 255;
  }

  checkCancelled(signal);

  return {
    width: decoded.width,
    height: decoded.height,
    pixels: rgba,
  };
}
