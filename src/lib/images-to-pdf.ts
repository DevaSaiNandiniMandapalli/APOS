export const IMAGES_TO_PDF_LIMITS = {
  files: 20,
  totalBytes: 50 * 1024 * 1024,
  maxDimension: 12_000,
  maxPixels: 40_000_000,
} as const;

export function validateImageBatch(sizes: number[]) {
  if (!sizes.length) throw new Error("Choose at least one image.");
  if (sizes.length > IMAGES_TO_PDF_LIMITS.files) throw new Error(`Choose no more than ${IMAGES_TO_PDF_LIMITS.files} images.`);
  if (sizes.some((size) => !Number.isSafeInteger(size) || size <= 0)) throw new Error("Images must not be empty or have invalid sizes.");
  if (sizes.reduce((total, size) => total + size, 0) > IMAGES_TO_PDF_LIMITS.totalBytes) throw new Error("Choose images totaling no more than 50 MB.");
}

export function validateImageDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error("An image has invalid dimensions.");
  if (width > IMAGES_TO_PDF_LIMITS.maxDimension || height > IMAGES_TO_PDF_LIMITS.maxDimension || width * height > IMAGES_TO_PDF_LIMITS.maxPixels) {
    throw new Error("An image exceeds the 12,000-pixel or 40-megapixel limit. Resize it first.");
  }
}

export function imageFormatFromSignature(bytes: Uint8Array): "png" | "jpeg" | null {
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return "png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  return null;
}

export type ImagesToPdfPageSize = "a4" | "a3" | "a5" | "letter" | "legal" | "image" | "custom";
export type ImagesToPdfOrientation = "auto" | "portrait" | "landscape";
export type ImagesToPdfMargin = "none" | "small" | "medium" | "large" | "custom";
export type ImagesToPdfFit = "fit" | "fill" | "original" | "center";
export type ImagesToPdfCompression = "original" | "jpeg" | "png";

export type ImagesToPdfSettings = {
  pageSize: ImagesToPdfPageSize;
  orientation: ImagesToPdfOrientation;
  margin: ImagesToPdfMargin;
  customMarginMm: number;
  customWidthMm: number;
  customHeightMm: number;
  fit: ImagesToPdfFit;
  background: string;
  compression: ImagesToPdfCompression;
  quality: number;
  outputName: string;
};

export const PAGE_SIZE_POINTS = {
  a4: { width: 595.28, height: 841.89, label: "A4" },
  a3: { width: 841.89, height: 1190.55, label: "A3" },
  a5: { width: 419.53, height: 595.28, label: "A5" },
  letter: { width: 612, height: 792, label: "Letter" },
  legal: { width: 612, height: 1008, label: "Legal" },
} as const;

export const MARGIN_POINTS = { none: 0, small: 18, medium: 36, large: 54 } as const;
export const MM_TO_POINTS = 72 / 25.4;

export function validateImagesToPdfSettings(settings: ImagesToPdfSettings) {
  if (!["a4", "a3", "a5", "letter", "legal", "image", "custom"].includes(settings.pageSize)) throw new Error("Choose a supported page size.");
  if (!["auto", "portrait", "landscape"].includes(settings.orientation)) throw new Error("Choose a supported orientation.");
  if (!["none", "small", "medium", "large", "custom"].includes(settings.margin)) throw new Error("Choose a supported margin.");
  if (!["fit", "fill", "original", "center"].includes(settings.fit)) throw new Error("Choose a supported image placement.");
  if (!["original", "jpeg", "png"].includes(settings.compression)) throw new Error("Choose a supported image compression setting.");
  if (!/^#[0-9a-f]{6}$/i.test(settings.background)) throw new Error("Choose a valid background colour.");
  if (!Number.isFinite(settings.quality) || settings.quality < 0.1 || settings.quality > 1) throw new Error("JPEG quality must be between 10% and 100%.");
  if (settings.margin === "custom" && (!Number.isFinite(settings.customMarginMm) || settings.customMarginMm < 0 || settings.customMarginMm > 200)) throw new Error("Custom margins must be between 0 and 200 mm.");
  if (settings.pageSize === "custom" && (!Number.isFinite(settings.customWidthMm) || !Number.isFinite(settings.customHeightMm) || settings.customWidthMm < 10 || settings.customHeightMm < 10 || settings.customWidthMm > 2000 || settings.customHeightMm > 2000)) throw new Error("Custom page dimensions must be between 10 and 2,000 mm.");
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(settings.outputName)) throw new Error("The output filename contains unsupported characters.");
}

export function marginPoints(settings: Pick<ImagesToPdfSettings, "margin" | "customMarginMm">) {
  return settings.margin === "custom" ? settings.customMarginMm * MM_TO_POINTS : MARGIN_POINTS[settings.margin] ?? 0;
}

export function pageDimensions(
  settings: Pick<ImagesToPdfSettings, "pageSize" | "orientation" | "customWidthMm" | "customHeightMm">,
  imageWidth: number,
  imageHeight: number,
) {
  if (settings.pageSize === "image") return { width: Math.max(1, imageWidth), height: Math.max(1, imageHeight) };
  let base: { width: number; height: number };
  if (settings.pageSize === "custom") base = { width: settings.customWidthMm * MM_TO_POINTS, height: settings.customHeightMm * MM_TO_POINTS };
  else base = { ...PAGE_SIZE_POINTS[settings.pageSize] };
  const landscape = settings.orientation === "landscape" || (settings.orientation === "auto" && imageWidth > imageHeight);
  const portrait = settings.orientation === "portrait" || (settings.orientation === "auto" && imageHeight >= imageWidth);
  if (landscape) return { width: Math.max(base.width, base.height), height: Math.min(base.width, base.height) };
  if (portrait) return { width: Math.min(base.width, base.height), height: Math.max(base.width, base.height) };
  return base;
}

export function imagePlacement(
  imageWidth: number,
  imageHeight: number,
  pageWidth: number,
  pageHeight: number,
  margin: number,
  fit: ImagesToPdfFit,
) {
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  if (contentWidth <= 0 || contentHeight <= 0) throw new Error("The margins leave no usable space on the page. Reduce the margin or choose a larger page.");
  const naturalWidth = imageWidth * 0.75;
  const naturalHeight = imageHeight * 0.75;
  if (fit === "fill") {
    const scale = Math.max(contentWidth / imageWidth, contentHeight / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return { x: margin + (contentWidth - width) / 2, y: margin + (contentHeight - height) / 2, width, height };
  }
  if (fit === "original" || fit === "center") {
    const x = fit === "center" ? margin + (contentWidth - naturalWidth) / 2 : margin;
    const y = fit === "center" ? margin + (contentHeight - naturalHeight) / 2 : pageHeight - margin - naturalHeight;
    return { x, y, width: naturalWidth, height: naturalHeight };
  }
  const scale = Math.min(contentWidth / imageWidth, contentHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { x: margin + (contentWidth - width) / 2, y: margin + (contentHeight - height) / 2, width, height };
}

export function safeImagesPdfName(value: string, fallback = "images.pdf") {
  const trimmed = value.trim();
  const name = (trimmed || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/^[.\- ]+|[.\- ]+$/g, "");
  const stem = name.replace(/\.pdf$/i, "").slice(0, 100) || "images";
  return `${stem}.pdf`;
}

export function hexToRgb(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) return [1, 1, 1];
  return [parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255];
}
