import {
  EncryptedPDFError,
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type Color,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "@cantoo/pdf-lib";
import { PDF_LIMITS, checkPdfHeader } from "./pdf-limits";
import {
  getAnnotationBounds,
  isMeaningfulAnnotation,
  type AnnotationBounds,
  type PagePoint,
  type PdfAnnotation,
} from "./pdf-annotations";

export type PdfExportErrorCode =
  | "empty"
  | "too-large"
  | "signature"
  | "encrypted"
  | "corrupt"
  | "page-limit"
  | "empty-annotations"
  | "unsupported-page"
  | "unsupported-text"
  | "unsupported-image"
  | "output";

export class PdfExportError extends Error {
  constructor(
    public readonly code: PdfExportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PdfExportError";
  }
}

export type PageRotation = 0 | 90 | 180 | 270;

/** Crop-box geometry and page rotation used to map on-screen coordinates to PDF space. */
export type PdfPageGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: PageRotation;
};

export type DisplaySize = {
  width: number;
  height: number;
};

const PDF_RED = rgb(210 / 255, 65 / 255, 65 / 255);
const PDF_BLUE = rgb(35 / 255, 93 / 255, 190 / 255);
const PDF_HIGHLIGHT = rgb(1, 230 / 255, 0);
const PDF_HIGHLIGHT_BORDER = rgb(200 / 255, 160 / 255, 0);
const PDF_WHITE = rgb(1, 1, 1);

const LINE_THICKNESS = 2.5;
const SHAPE_THICKNESS = 2;
const TEXT_PADDING = 3;
const TEXT_ASCENT = 0.8;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Helvetica (WinAnsi) is a single-byte encoding: reject anything it cannot encode. */
const WINANSI_MAX_CODE = 0xff;
const UNDEFINED_WINANSI_CODES = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);

function assertTextEncodable(text: string): void {
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    if (code > WINANSI_MAX_CODE || UNDEFINED_WINANSI_CODES.has(code)) {
      throw new PdfExportError(
        "unsupported-text",
        "The text box contains characters that the built-in Helvetica font cannot encode. Simplify the text and try again.",
      );
    }
  }
}


export function normalizePageRotation(angle: number): PageRotation {
  if (!Number.isFinite(angle)) return 0;
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return normalized as PageRotation;
}

export function getPageGeometry(page: PDFPage): PdfPageGeometry {
  const cropBox = page.getCropBox();

  return {
    x: cropBox.x,
    y: cropBox.y,
    width: cropBox.width,
    height: cropBox.height,
    rotation: normalizePageRotation(page.getRotation().angle),
  };
}

/** Size of the page as displayed after its /Rotate value is applied. */
export function getDisplaySize(geometry: PdfPageGeometry): DisplaySize {
  const { width, height, rotation } = geometry;

  return rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height };
}

/**
 * Map a normalized on-screen point (origin top-left, y down) to PDF user
 * space (origin bottom-left, y up) for the page's crop box and rotation.
 */
export function visualPointToPdf(
  geometry: PdfPageGeometry,
  point: PagePoint,
): PagePoint {
  const u = clamp01(point.x);
  const v = clamp01(point.y);
  const { x, y, width, height, rotation } = geometry;

  switch (rotation) {
    case 90:
      return { x: x + v * width, y: y + u * height };
    case 180:
      return { x: x + (1 - u) * width, y: y + v * height };
    case 270:
      return { x: x + (1 - v) * width, y: y + (1 - u) * height };
    default:
      return { x: x + u * width, y: y + (1 - v) * height };
  }
}

/** Axis-aligned PDF rectangle covering a normalized on-screen rectangle. */
export function visualRectToPdf(
  geometry: PdfPageGeometry,
  bounds: AnnotationBounds,
): AnnotationBounds {
  const first = visualPointToPdf(geometry, {
    x: bounds.x,
    y: bounds.y,
  });
  const opposite = visualPointToPdf(geometry, {
    x: bounds.x + bounds.width,
    y: bounds.y + bounds.height,
  });
  const left = Math.min(first.x, opposite.x);
  const top = Math.min(first.y, opposite.y);

  return {
    x: left,
    y: top,
    width: Math.abs(opposite.x - first.x),
    height: Math.abs(opposite.y - first.y),
  };
}

/** Baseline anchor, size and wrap width for a text-box annotation. */
export function getTextBoxMetrics(
  geometry: PdfPageGeometry,
  annotation: Extract<PdfAnnotation, { kind: "text-box" }>,
): {
  anchor: PagePoint;
  fontSize: number;
  lineHeight: number;
  maxWidth: number;
} {
  const display = getDisplaySize(geometry);
  const fontSize = Math.max(1, annotation.fontSize * display.height);
  const padding = Math.min(TEXT_PADDING, (annotation.width * display.width) / 4);
  const baseline = visualPointToPdf(geometry, {
    x: annotation.x + padding / display.width,
    y:
      annotation.y +
      (padding + fontSize * TEXT_ASCENT) / display.height,
  });

  return {
    anchor: baseline,
    fontSize,
    lineHeight: fontSize * 1.2,
    maxWidth: Math.max(1, annotation.width * display.width - padding * 2),
  };
}

function parseHexColor(value: string): Color {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return PDF_BLUE;

  const number = Number.parseInt(match[1], 16);

  return rgb(
    ((number >> 16) & 0xff) / 255,
    ((number >> 8) & 0xff) / 255,
    (number & 0xff) / 255,
  );
}

type DecodedOverlayImage = {
  bytes: Uint8Array;
  format: "png" | "jpeg";
};

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function convertWebpToPng(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof createImageBitmap !== "function") {
    throw new PdfExportError(
      "unsupported-image",
      "WebP image overlays need a browser with image conversion support. Use a PNG or JPEG image instead.",
    );
  }

  const bitmap = await createImageBitmap(new Blob([bytes.buffer as ArrayBuffer], { type: "image/webp" }));

  try {
    let png: Blob;

    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");

      if (!context) {
        throw new PdfExportError(
          "unsupported-image",
          "WebP image overlays could not be converted in this environment.",
        );
      }

      context.drawImage(bitmap, 0, 0);
      png = await canvas.convertToBlob({ type: "image/png" });
    } else if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new PdfExportError(
          "unsupported-image",
          "WebP image overlays could not be converted in this environment.",
        );
      }

      context.drawImage(bitmap, 0, 0);
      png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error("PNG conversion failed.")),
          "image/png",
        );
      });
    } else {
      throw new PdfExportError(
        "unsupported-image",
        "WebP image overlays could not be converted in this environment.",
      );
    }

    return new Uint8Array(await png.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

async function decodeOverlaySource(src: string): Promise<DecodedOverlayImage> {
  const match = /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=\s]+)$/i.exec(src);

  if (!match) {
    throw new PdfExportError(
      "unsupported-image",
      "An image overlay could not be decoded. Use a PNG, JPEG or WebP image.",
    );
  }

  const format = match[1].toLowerCase();
  const bytes = base64ToBytes(match[2]);

  if (!bytes.byteLength) {
    throw new PdfExportError("unsupported-image", "An image overlay is empty.");
  }

  if (format === "webp") {
    return { bytes: await convertWebpToPng(bytes), format: "png" };
  }

  return { bytes, format: format as "png" | "jpeg" };
}

function drawLineBetween(
  page: PDFPage,
  start: PagePoint,
  end: PagePoint,
  color: Color,
  thickness = LINE_THICKNESS,
  opacity = 0.95,
) {
  page.drawLine({
    start,
    end,
    thickness,
    color,
    opacity,
  });
}

function drawArrowHead(
  page: PDFPage,
  start: PagePoint,
  end: PagePoint,
  color: Color,
) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);

  if (length < 1) return;

  const unitX = deltaX / length;
  const unitY = deltaY / length;
  const headLength = Math.min(12, length * 0.4);
  const headWidth = Math.min(6, length * 0.2);
  const base = {
    x: end.x - unitX * headLength,
    y: end.y - unitY * headLength,
  };
  const perpendicular = { x: -unitY, y: unitX };

  drawLineBetween(
    page,
    end,
    {
      x: base.x + perpendicular.x * headWidth,
      y: base.y + perpendicular.y * headWidth,
    },
    color,
  );
  drawLineBetween(
    page,
    end,
    {
      x: base.x - perpendicular.x * headWidth,
      y: base.y - perpendicular.y * headWidth,
    },
    color,
  );
}

async function drawAnnotation(
  pdf: PDFDocument,
  page: PDFPage,
  geometry: PdfPageGeometry,
  annotation: PdfAnnotation,
  font: PDFFont | null,
  imageCache: Map<string, PDFImage>,
) {
  const bounds = getAnnotationBounds(annotation);

  if (annotation.kind === "highlight" || annotation.kind === "underline" || annotation.kind === "strikethrough") {
    if (annotation.kind === "highlight") {
      page.drawRectangle({
        ...visualRectToPdf(geometry, bounds),
        color: PDF_HIGHLIGHT,
        opacity: 0.4,
        borderColor: PDF_HIGHLIGHT_BORDER,
        borderOpacity: 0.7,
        borderWidth: 1,
      });
      return;
    }

    const y = annotation.kind === "underline"
      ? bounds.y + bounds.height
      : bounds.y + bounds.height / 2;

    drawLineBetween(
      page,
      visualPointToPdf(geometry, { x: bounds.x, y }),
      visualPointToPdf(geometry, { x: bounds.x + bounds.width, y }),
      annotation.kind === "underline" ? PDF_BLUE : PDF_RED,
      SHAPE_THICKNESS,
    );
    return;
  }

  if (annotation.kind === "rectangle") {
    page.drawRectangle({
      ...visualRectToPdf(geometry, bounds),
      color: PDF_BLUE,
      opacity: 0.06,
      borderColor: PDF_BLUE,
      borderOpacity: 0.95,
      borderWidth: SHAPE_THICKNESS,
    });
    return;
  }

  if (annotation.kind === "circle") {
    const rect = visualRectToPdf(geometry, bounds);
    page.drawEllipse({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      xScale: rect.width / 2,
      yScale: rect.height / 2,
      color: PDF_BLUE,
      opacity: 0.06,
      borderColor: PDF_BLUE,
      borderOpacity: 0.95,
      borderWidth: SHAPE_THICKNESS,
    });
    return;
  }

  if (annotation.kind === "line" || annotation.kind === "arrow") {
    const start = visualPointToPdf(geometry, annotation.start);
    const end = visualPointToPdf(geometry, annotation.end);

    drawLineBetween(page, start, end, PDF_BLUE);
    if (annotation.kind === "arrow") drawArrowHead(page, start, end, PDF_BLUE);
    return;
  }

  if (annotation.kind === "freehand") {
    for (let index = 1; index < annotation.points.length; index += 1) {
      drawLineBetween(
        page,
        visualPointToPdf(geometry, annotation.points[index - 1]),
        visualPointToPdf(geometry, annotation.points[index]),
        PDF_BLUE,
      );
    }
    return;
  }

  if (annotation.kind === "text-box") {
    if (!font) {
      throw new PdfExportError("output", "The text font could not be embedded.");
    }

    assertTextEncodable(annotation.text);

    const rect = visualRectToPdf(geometry, bounds);
    const metrics = getTextBoxMetrics(geometry, annotation);

    page.drawRectangle({
      ...rect,
      color: PDF_WHITE,
      opacity: 0.82,
      borderColor: PDF_BLUE,
      borderOpacity: 0.55,
      borderWidth: 1,
    });

    try {
      page.drawText(annotation.text, {
        x: metrics.anchor.x,
        y: metrics.anchor.y,
        size: metrics.fontSize,
        font,
        color: parseHexColor(annotation.color),
        rotate: degrees(geometry.rotation),
        lineHeight: metrics.lineHeight,
        maxWidth: metrics.maxWidth,
      });
    } catch {
      throw new PdfExportError(
        "unsupported-text",
        "The text box contains characters that the built-in Helvetica font cannot encode. Simplify the text and try again.",
      );
    }
    return;
  }

  if (annotation.kind === "image") {
    let image = imageCache.get(annotation.src) ?? null;

    if (!image) {
      const decoded = await decodeOverlaySource(annotation.src);
      image = decoded.format === "png"
        ? await pdf.embedPng(decoded.bytes)
        : await pdf.embedJpg(decoded.bytes);
      imageCache.set(annotation.src, image);
    }

    if (!image) {
      throw new PdfExportError(
        "unsupported-image",
        "An image overlay could not be embedded.",
      );
    }

    const display = getDisplaySize(geometry);
    const anchor = visualPointToPdf(geometry, {
      x: annotation.x,
      y: annotation.y + annotation.height,
    });

    page.drawImage(image, {
      x: anchor.x,
      y: anchor.y,
      width: annotation.width * display.width,
      height: annotation.height * display.height,
      rotate: degrees(geometry.rotation),
    });

    page.drawRectangle({
      ...visualRectToPdf(geometry, bounds),
      borderColor: PDF_BLUE,
      borderOpacity: 0.45,
      borderWidth: 1,
    });
  }
}

/**
 * Flatten every meaningful annotation into the original PDF and return a new
 * PDF. The source document is never modified: pages, content and metadata are
 * preserved, and annotations are drawn on top of each page's existing content.
 */
export async function exportAnnotatedPdf(
  source: Uint8Array,
  annotations: readonly PdfAnnotation[],
): Promise<Uint8Array> {
  if (!source.byteLength) {
    throw new PdfExportError("empty", "Choose a PDF to export.");
  }

  if (source.byteLength > PDF_LIMITS.perFileBytes) {
    throw new PdfExportError(
      "too-large",
      "The PDF exceeds the 50 MB export limit.",
    );
  }

  if (!checkPdfHeader(source)) {
    throw new PdfExportError(
      "signature",
      "This file does not have a PDF signature and cannot be exported.",
    );
  }

  const meaningful = annotations.filter(isMeaningfulAnnotation);

  if (!meaningful.length) {
    throw new PdfExportError(
      "empty-annotations",
      "Add at least one annotation before downloading an edited PDF.",
    );
  }

  let pdf: PDFDocument;

  try {
    pdf = await PDFDocument.load(source, { updateMetadata: false });
  } catch (error) {
    if (
      error instanceof EncryptedPDFError ||
      (error instanceof Error && /encrypt|password/i.test(error.message))
    ) {
      throw new PdfExportError(
        "encrypted",
        "This PDF is encrypted or password protected. Unlock it before exporting annotations.",
      );
    }

    throw new PdfExportError(
      "corrupt",
      "This PDF could not be opened. It may be corrupt or unsupported.",
    );
  }

  if (pdf.isEncrypted) {
    throw new PdfExportError(
      "encrypted",
      "This PDF is encrypted or password protected. Unlock it before exporting annotations.",
    );
  }

  let pageCount: number;
  try {
    pageCount = pdf.getPageCount();
  } catch {
    throw new PdfExportError(
      "corrupt",
      "This PDF could not be opened. It may be corrupt or unsupported.",
    );
  }

  if (pageCount < 1 || pageCount > PDF_LIMITS.pages) {
    throw new PdfExportError(
      "page-limit",
      `The PDF must contain 1-${PDF_LIMITS.pages} pages to export annotations.`,
    );
  }

  for (const annotation of meaningful) {
    if (
      !Number.isInteger(annotation.page) ||
      annotation.page < 1 ||
      annotation.page > pageCount
    ) {
      throw new PdfExportError(
        "unsupported-page",
        "An annotation refers to a page that is not in this PDF.",
      );
    }
  }

  const needsText = meaningful.some((annotation) => annotation.kind === "text-box");
  const font = needsText ? await pdf.embedFont(StandardFonts.Helvetica) : null;
  const pages = pdf.getPages();
  const imageCache = new Map<string, PDFImage>();

  for (const annotation of meaningful) {
    const page = pages[annotation.page - 1];
    const geometry = getPageGeometry(page);

    await drawAnnotation(
      pdf,
      page,
      geometry,
      annotation,
      font,
      imageCache,
    );
  }

  const output = new Uint8Array(await pdf.save({ useObjectStreams: true }));

  if (!output.byteLength || output.byteLength > PDF_LIMITS.perFileBytes) {
    throw new PdfExportError(
      "output",
      "The exported PDF exceeded the 50 MB output limit.",
    );
  }

  if (!checkPdfHeader(output)) {
    throw new PdfExportError(
      "output",
      "The exported PDF failed its signature check.",
    );
  }

  try {
    const verified = await PDFDocument.load(output, { updateMetadata: false });

    if (verified.getPageCount() !== pageCount) {
      throw new Error("Page count changed.");
    }
  } catch {
    throw new PdfExportError(
      "output",
      "The exported PDF could not be reopened for validation.",
    );
  }

  return output;
}

export { annotatedPdfFileName } from "./pdf-export-name";
