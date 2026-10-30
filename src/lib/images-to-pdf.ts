export const IMAGES_TO_PDF_LIMITS = { files: 20, totalBytes: 50 * 1024 * 1024 } as const;

export function validateImageBatch(sizes: number[]) {
  if (!sizes.length) throw new Error("Choose at least one image.");
  if (sizes.length > IMAGES_TO_PDF_LIMITS.files) throw new Error(`Choose no more than ${IMAGES_TO_PDF_LIMITS.files} images.`);
  if (sizes.some((size) => !Number.isSafeInteger(size) || size <= 0)) throw new Error("Images must not be empty or have invalid sizes.");
  if (sizes.reduce((total, size) => total + size, 0) > IMAGES_TO_PDF_LIMITS.totalBytes) throw new Error("Choose images totaling no more than 50 MB.");
}

export function imageFormatFromSignature(bytes: Uint8Array): "png" | "jpeg" | null {
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return "png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  return null;
}
