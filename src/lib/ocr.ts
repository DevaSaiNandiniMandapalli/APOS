export const OCR_ACCEPT = "image/png,image/jpeg,image/webp,image/bmp";
export const OCR_MAX_BYTES = 15 * 1024 * 1024;

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/bmp"];

export function validateOcrFile(file: { name: string; type: string; size: number }): string | null {
  if (!file.name) return "Choose an image first.";
  if (file.size > OCR_MAX_BYTES) return "Image is too large (limit 15 MB).";
  const looksLikeImage = ALLOWED_TYPES.includes(file.type) || /\.(png|jpe?g|webp|bmp)$/i.test(file.name);
  if (!looksLikeImage) return "Use a PNG, JPG, WEBP or BMP image.";
  return null;
}

export function normalizeOcrText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
