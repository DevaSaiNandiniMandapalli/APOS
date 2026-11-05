export const ANNOTATION_TOOLS = [
  "highlight",
  "underline",
  "strikethrough",
  "freehand",
  "rectangle",
  "circle",
  "line",
  "arrow",
  "text-box",
  "image",
] as const;

export type AnnotationTool = (typeof ANNOTATION_TOOLS)[number];
export type ViewerTool = AnnotationTool | "select" | null;

export type PagePoint = {
  x: number;
  y: number;
};

export type AnnotationBounds = PagePoint & {
  width: number;
  height: number;
};

type AnnotationBase = {
  id: number;
  page: number;
};

type BoxAnnotation = AnnotationBase &
  AnnotationBounds & {
    kind: "highlight" | "underline" | "strikethrough" | "rectangle" | "circle";
  };

export type TextAnnotationStyle = {
  /** Font size relative to PDF page height. */
  fontSize: number;
  color: string;
};

export const DEFAULT_TEXT_ANNOTATION_STYLE: TextAnnotationStyle = {
  fontSize: 0.025,
  color: "#17365d",
};

export type TextBoxAnnotation = AnnotationBase &
  AnnotationBounds &
  TextAnnotationStyle & {
    kind: "text-box";
    text: string;
  };

export type ImageOverlayAnnotation = AnnotationBase &
  AnnotationBounds & {
    kind: "image";
    src: string;
    name: string;
  };

export type FreehandAnnotation = AnnotationBase & {
  kind: "freehand";
  points: PagePoint[];
};

export type LineAnnotation = AnnotationBase & {
  kind: "line" | "arrow";
  start: PagePoint;
  end: PagePoint;
};

export type PdfAnnotation =
  | BoxAnnotation
  | TextBoxAnnotation
  | ImageOverlayAnnotation
  | FreehandAnnotation
  | LineAnnotation;

export type AnnotationComment = {
  id: number;
  page: number;
  annotationId: number | null;
  text: string;
};

/** Browser-session annotation state. This is never written back into the PDF. */
export type AnnotationDocument = {
  annotations: PdfAnnotation[];
  comments: AnnotationComment[];
};

export function createEmptyAnnotationDocument(): AnnotationDocument {
  return { annotations: [], comments: [] };
}

export const ANNOTATION_TOOL_LABELS: Record<AnnotationTool, string> = {
  highlight: "Highlight",
  underline: "Underline",
  strikethrough: "Strikethrough",
  freehand: "Freehand",
  rectangle: "Rectangle",
  circle: "Circle",
  line: "Line",
  arrow: "Arrow",
  "text-box": "Text box",
  image: "Image overlay",
};

export const IMAGE_OVERLAY_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_OVERLAY_FORMATS = ["png", "jpeg", "webp"] as const;

export type ImageOverlayFormat = (typeof IMAGE_OVERLAY_FORMATS)[number];
export type ImageOverlayValidation =
  | { ok: true; format: ImageOverlayFormat }
  | { ok: false; error: string };

export function detectImageOverlayType(bytes: Uint8Array): ImageOverlayFormat | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "png";

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "webp";

  return null;
}

/** Validate an overlay by size and file signature, never by filename or MIME type. */
export function validateImageOverlayFile(
  size: number,
  bytes: Uint8Array,
): ImageOverlayValidation {
  if (size <= 0 || bytes.length === 0) {
    return { ok: false, error: "Choose a non-empty image file." };
  }

  if (size > IMAGE_OVERLAY_MAX_BYTES) {
    return {
      ok: false,
      error: "Choose an image smaller than 2 MB for a browser-session overlay.",
    };
  }

  const format = detectImageOverlayType(bytes);

  if (!format) {
    return {
      ok: false,
      error: "Only PNG, JPEG and WebP images are supported for overlays.",
    };
  }

  return { ok: true, format };
}

export function isImageOverlaySource(src: string): boolean {
  return (
    src.startsWith("data:image/png;base64,") ||
    src.startsWith("data:image/jpeg;base64,") ||
    src.startsWith("data:image/webp;base64,")
  );
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Convert a pointer position to normalized PDF-page coordinates (0 to 1). */
export function toPagePoint(
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
): PagePoint {
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 };

  return {
    x: clamp((clientX - bounds.left) / bounds.width),
    y: clamp((clientY - bounds.top) / bounds.height),
  };
}

/** Convert normalized PDF-page coordinates to the currently rendered viewport. */
export function toViewportPoint(
  point: PagePoint,
  width: number,
  height: number,
): PagePoint {
  return { x: point.x * width, y: point.y * height };
}

export function boxFromPoints(start: PagePoint, end: PagePoint): AnnotationBounds {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function createDraftAnnotation(
  tool: AnnotationTool,
  start: PagePoint,
  current: PagePoint,
  page: number,
  text = "",
  textStyle: TextAnnotationStyle = DEFAULT_TEXT_ANNOTATION_STYLE,
  image: Pick<ImageOverlayAnnotation, "src" | "name"> = { src: "", name: "" },
): PdfAnnotation {
  const base = { id: -1, page };

  if (tool === "freehand") {
    return { ...base, kind: tool, points: [start] };
  }

  if (tool === "line" || tool === "arrow") {
    return { ...base, kind: tool, start, end: current };
  }

  return {
    ...base,
    ...boxFromPoints(start, current),
    ...(tool === "text-box"
      ? { kind: tool, text, ...textStyle }
      : tool === "image"
        ? { kind: tool, ...image }
        : { kind: tool }),
  } as PdfAnnotation;
}

export function appendFreehandPoint(
  annotation: FreehandAnnotation,
  point: PagePoint,
): FreehandAnnotation {
  const previous = annotation.points.at(-1);
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.0015) {
    return annotation;
  }

  return { ...annotation, points: [...annotation.points, point] };
}

export function getAnnotationBounds(annotation: PdfAnnotation): AnnotationBounds {
  if ("width" in annotation) {
    return {
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height,
    };
  }

  const points = annotation.kind === "freehand"
    ? annotation.points
    : [annotation.start, annotation.end];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);

  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

export function isMeaningfulAnnotation(annotation: PdfAnnotation): boolean {
  if (annotation.kind === "freehand") {
    return annotation.points.some((point, index) => {
      const start = annotation.points[0];
      return index > 0 && Math.hypot(point.x - start.x, point.y - start.y) > 0.002;
    });
  }

  if ("start" in annotation) {
    return Math.hypot(
      annotation.end.x - annotation.start.x,
      annotation.end.y - annotation.start.y,
    ) > 0.005;
  }

  if (annotation.kind === "text-box" && !annotation.text.trim()) return false;
  if (annotation.kind === "image" && !isImageOverlaySource(annotation.src)) return false;
  return annotation.width > 0.003 && annotation.height > 0.003;
}

export const MIN_ANNOTATION_SIZE = 0.01;

const clampValue = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

function normalizeBounds(bounds: AnnotationBounds): AnnotationBounds {
  const width = clampValue(bounds.width, 0, 1);
  const height = clampValue(bounds.height, 0, 1);

  return {
    x: clampValue(bounds.x, 0, 1 - width),
    y: clampValue(bounds.y, 0, 1 - height),
    width,
    height,
  };
}

export function annotationContainsPoint(
  annotation: PdfAnnotation,
  point: PagePoint,
  tolerance = 0.004,
): boolean {
  const bounds = getAnnotationBounds(annotation);

  return (
    point.x >= bounds.x - tolerance &&
    point.x <= bounds.x + bounds.width + tolerance &&
    point.y >= bounds.y - tolerance &&
    point.y <= bounds.y + bounds.height + tolerance
  );
}

/** Return the topmost annotation on the page at the supplied normalized point. */
export function findAnnotationAtPoint(
  annotations: readonly PdfAnnotation[],
  point: PagePoint,
): PdfAnnotation | null {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    if (annotations[index] && annotationContainsPoint(annotations[index], point)) {
      return annotations[index];
    }
  }

  return null;
}

function translatePoint(point: PagePoint, x: number, y: number): PagePoint {
  return { x: point.x + x, y: point.y + y };
}

/** Move an annotation while keeping its complete bounds inside the page. */
export function moveAnnotation(
  annotation: PdfAnnotation,
  deltaX: number,
  deltaY: number,
): PdfAnnotation {
  const bounds = getAnnotationBounds(annotation);
  const x = clampValue(deltaX, -bounds.x, 1 - bounds.x - bounds.width);
  const y = clampValue(deltaY, -bounds.y, 1 - bounds.y - bounds.height);

  if (x === 0 && y === 0) return annotation;

  if ("width" in annotation) {
    return { ...annotation, x: annotation.x + x, y: annotation.y + y };
  }

  if (annotation.kind === "freehand") {
    return {
      ...annotation,
      points: annotation.points.map((point) => translatePoint(point, x, y)),
    };
  }

  return {
    ...annotation,
    start: translatePoint(annotation.start, x, y),
    end: translatePoint(annotation.end, x, y),
  };
}

/**
 * Replace an annotation's normalized bounds. Point-based annotations are
 * scaled from their previous bounding box so freehand, line and arrow data
 * stay consistent with the visible selection frame.
 */
export function resizeAnnotation(
  annotation: PdfAnnotation,
  nextBounds: AnnotationBounds,
): PdfAnnotation {
  const bounds = normalizeBounds(nextBounds);
  const previous = getAnnotationBounds(annotation);

  if ("width" in annotation) {
    return { ...annotation, ...bounds };
  }

  const scalePoint = (point: PagePoint): PagePoint => ({
    x: previous.width > 0
      ? bounds.x + ((point.x - previous.x) / previous.width) * bounds.width
      : bounds.x + bounds.width / 2,
    y: previous.height > 0
      ? bounds.y + ((point.y - previous.y) / previous.height) * bounds.height
      : bounds.y + bounds.height / 2,
  });

  if (annotation.kind === "freehand") {
    return { ...annotation, points: annotation.points.map(scalePoint) };
  }

  return {
    ...annotation,
    start: scalePoint(annotation.start),
    end: scalePoint(annotation.end),
  };
}

export const RESIZE_HANDLES = ["nw", "ne", "sw", "se"] as const;

export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

export const RESIZE_HANDLE_LABELS: Record<ResizeHandle, string> = {
  nw: "top-left",
  ne: "top-right",
  sw: "bottom-left",
  se: "bottom-right",
};

/** Build clamped bounds while dragging one corner of a selection frame. */
export function resizeBoundsFromHandle(
  bounds: AnnotationBounds,
  handle: ResizeHandle,
  point: PagePoint,
): AnnotationBounds {
  let left = bounds.x;
  let right = bounds.x + bounds.width;
  let top = bounds.y;
  let bottom = bounds.y + bounds.height;
  const x = clampValue(point.x, 0, 1);
  const y = clampValue(point.y, 0, 1);

  if (handle === "nw" || handle === "sw") {
    left = Math.min(x, right - MIN_ANNOTATION_SIZE);
  } else {
    right = Math.max(x, left + MIN_ANNOTATION_SIZE);
  }

  if (handle === "nw" || handle === "ne") {
    top = Math.min(y, bottom - MIN_ANNOTATION_SIZE);
  } else {
    bottom = Math.max(y, top + MIN_ANNOTATION_SIZE);
  }

  left = clampValue(left, 0, 1 - MIN_ANNOTATION_SIZE);
  right = clampValue(right, left + MIN_ANNOTATION_SIZE, 1);
  top = clampValue(top, 0, 1 - MIN_ANNOTATION_SIZE);
  bottom = clampValue(bottom, top + MIN_ANNOTATION_SIZE, 1);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function createAnnotationComment(
  id: number,
  page: number,
  text: string,
  annotationId: number | null = null,
): AnnotationComment {
  return { id, page, annotationId, text: text.trim() };
}

export function isMeaningfulComment(comment: AnnotationComment): boolean {
  return comment.text.trim().length > 0;
}

export function addAnnotationComment(
  document: AnnotationDocument,
  comment: AnnotationComment,
): AnnotationDocument {
  if (!isMeaningfulComment(comment)) return document;

  return { ...document, comments: [...document.comments, comment] };
}

export function removeAnnotationComment(
  document: AnnotationDocument,
  commentId: number,
): AnnotationDocument {
  return {
    ...document,
    comments: document.comments.filter((comment) => comment.id !== commentId),
  };
}

/** Delete an annotation and all comments attached directly to it. */
export function removeAnnotationFromDocument(
  document: AnnotationDocument,
  annotationId: number,
): AnnotationDocument {
  return {
    annotations: document.annotations.filter(
      (annotation) => annotation.id !== annotationId,
    ),
    comments: document.comments.filter(
      (comment) => comment.annotationId !== annotationId,
    ),
  };
}
