import {
  CONVERSION_LIMITS,
} from "./conversion-engine";

import type {
  ConversionFormat,
  ConversionProgress,
  ConversionResult,
} from "./conversion-engine";

import {
  identifyImageFormat,
  imageFormatSignature,
  readImageDimensions,
} from "./image-format";

export type ImageOutputFormat = "png" | "jpeg" | "webp";

const MIME_TYPES: Record<ImageOutputFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const MAX_IMAGE_DIMENSION = 12_000;
const MAX_IMAGE_PIXELS = 40_000_000;

type ImageSettings = Readonly<
  Record<string, boolean | number | string>
>;

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Image conversion cancelled.", "AbortError");
  }
}

function validateDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new Error("The image dimensions exceed the supported limits.");
  }
}

function getOutputDimensions(
  originalWidth: number,
  originalHeight: number,
  settings: ImageSettings,
): { width: number; height: number } {
  const requestedWidth = settings.width;
  const requestedHeight = settings.height;

  if (
    requestedWidth !== undefined &&
    (typeof requestedWidth !== "number" ||
      !Number.isInteger(requestedWidth) ||
      requestedWidth < 1)
  ) {
    throw new Error("The requested image width is invalid.");
  }

  if (
    requestedHeight !== undefined &&
    (typeof requestedHeight !== "number" ||
      !Number.isInteger(requestedHeight) ||
      requestedHeight < 1)
  ) {
    throw new Error("The requested image height is invalid.");
  }

  const width = requestedWidth as number | undefined;
  const height = requestedHeight as number | undefined;

  if (width === undefined && height === undefined) {
    validateDimensions(originalWidth, originalHeight);
    return { width: originalWidth, height: originalHeight };
  }

  const scale = Math.min(
    1,
    width === undefined ? Infinity : width / originalWidth,
    height === undefined ? Infinity : height / originalHeight,
  );

  const outputWidth = Math.max(1, Math.round(originalWidth * scale));
  const outputHeight = Math.max(1, Math.round(originalHeight * scale));

  validateDimensions(outputWidth, outputHeight);

  return { width: outputWidth, height: outputHeight };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("The browser could not encode the image."));
            return;
          }

          resolve(blob);
        },
        mimeType,
        quality,
      );
    } catch {
      reject(new Error("The browser image encoder failed."));
    }
  });
}

export async function convertImageFile(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
  outputFormat: ImageOutputFormat,
  settings: ImageSettings,
  signal: AbortSignal,
  onProgress: (progress: ConversionProgress) => void,
): Promise<ConversionResult> {
  if (!file.size) {
    throw new Error("The selected image is empty.");
  }

  if (file.size > CONVERSION_LIMITS.inputFileBytes) {
    throw new Error("The image exceeds the maximum input file size.");
  }

  if (!Object.hasOwn(MIME_TYPES, outputFormat)) {
    throw new Error("The requested output image format is unsupported.");
  }

  checkAborted(signal);
  onProgress({ completed: 0, total: 4 });

  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;

  try {
    const inputBuffer = await file.arrayBuffer();
    checkAborted(signal);

    if (inputBuffer.byteLength !== file.size) {
      throw new Error("The image data size does not match the selected file.");
    }

    const inputBytes = new Uint8Array(inputBuffer);
    const inputFormat = identifyImageFormat(inputBytes);

    const supportedInputs: readonly ConversionFormat[] = [
      "png",
      "jpeg",
      "webp",
    ];

    if (!supportedInputs.includes(inputFormat)) {
      throw new Error("Only PNG, JPEG and WebP images are supported.");
    }

    if (!imageFormatSignature(inputBytes, inputFormat)) {
      throw new Error("The input image signature is invalid.");
    }

    const originalDimensions = readImageDimensions(
      inputBytes,
      inputFormat,
    );

    validateDimensions(
      originalDimensions.width,
      originalDimensions.height,
    );

    onProgress({ completed: 1, total: 4 });
    checkAborted(signal);

    const inputMimeType = MIME_TYPES[inputFormat as ImageOutputFormat];

    bitmap = await createImageBitmap(
      new Blob([inputBuffer], { type: inputMimeType }),
    );

    checkAborted(signal);

    if (
      (bitmap.width !== originalDimensions.width ||
        bitmap.height !== originalDimensions.height) &&
      (bitmap.width !== originalDimensions.height ||
        bitmap.height !== originalDimensions.width)
    ) {
      throw new Error("Decoded image dimensions do not match its header.");
    }

    const dimensions = getOutputDimensions(
      bitmap.width,
      bitmap.height,
      settings,
    );

    canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("The browser could not create a canvas context.");
    }

    if (outputFormat === "jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, dimensions.width, dimensions.height);
    }

    context.drawImage(
      bitmap,
      0,
      0,
      dimensions.width,
      dimensions.height,
    );

    onProgress({ completed: 2, total: 4 });
    checkAborted(signal);

    const requestedQuality = settings.quality;
    const quality =
      typeof requestedQuality === "number" &&
      Number.isFinite(requestedQuality)
        ? Math.min(1, Math.max(0.1, requestedQuality))
        : 0.92;

    const outputBlob = await canvasToBlob(
      canvas,
      MIME_TYPES[outputFormat],
      quality,
    );

    checkAborted(signal);

    if (!outputBlob.size) {
      throw new Error("The generated image is empty.");
    }

    if (outputBlob.size > CONVERSION_LIMITS.outputFileBytes) {
      throw new Error("The converted image exceeds the maximum output size.");
    }

    if (outputBlob.type !== MIME_TYPES[outputFormat]) {
      throw new Error("The browser returned an unexpected image MIME type.");
    }

    const outputBuffer = await outputBlob.arrayBuffer();
    checkAborted(signal);

    const outputBytes = new Uint8Array(outputBuffer);

    if (!imageFormatSignature(outputBytes, outputFormat)) {
      throw new Error("The generated image failed signature validation.");
    }

    const outputDimensions = readImageDimensions(
      outputBytes,
      outputFormat,
    );

    validateDimensions(
      outputDimensions.width,
      outputDimensions.height,
    );

    if (
      outputDimensions.width !== dimensions.width ||
      outputDimensions.height !== dimensions.height
    ) {
      throw new Error("The generated image dimensions are unexpected.");
    }

    onProgress({ completed: 4, total: 4 });

    return { bytes: outputBytes };
  } finally {
    bitmap?.close();

    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
