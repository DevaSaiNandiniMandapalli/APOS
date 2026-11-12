import type { PDFPage } from "@cantoo/pdf-lib";
import type { AnnotationBounds, PagePoint } from "./pdf-annotations";

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

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

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
