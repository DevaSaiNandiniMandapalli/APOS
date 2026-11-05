import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_ANNOTATION_STYLE,
  IMAGE_OVERLAY_MAX_BYTES,
  addAnnotationComment,
  appendFreehandPoint,
  boxFromPoints,
  createAnnotationComment,
  createDraftAnnotation,
  createEmptyAnnotationDocument,
  detectImageOverlayType,
  findAnnotationAtPoint,
  getAnnotationBounds,
  isImageOverlaySource,
  isMeaningfulAnnotation,
  isMeaningfulComment,
  moveAnnotation,
  removeAnnotationComment,
  removeAnnotationFromDocument,
  resizeAnnotation,
  resizeBoundsFromHandle,
  toPagePoint,
  toViewportPoint,
  validateImageOverlayFile,
} from "./pdf-annotations";

describe("PDF annotation page coordinates", () => {
  it("normalizes pointer positions and clamps them to the PDF page", () => {
    expect(toPagePoint(150, 250, { left: 100, top: 50, width: 200, height: 400 }))
      .toEqual({ x: 0.25, y: 0.5 });
    expect(toPagePoint(50, 500, { left: 100, top: 50, width: 200, height: 400 }))
      .toEqual({ x: 0, y: 1 });
    expect(toPagePoint(10, 10, { left: 0, top: 0, width: 0, height: 0 }))
      .toEqual({ x: 0, y: 0 });
  });

  it("keeps the same page-relative position at different zoom sizes", () => {
    const point = toPagePoint(250, 350, { left: 50, top: 50, width: 400, height: 600 });
    expect(toViewportPoint(point, 400, 600)).toEqual({ x: 200, y: 300 });
    expect(toViewportPoint(point, 800, 1200)).toEqual({ x: 400, y: 600 });
  });

  it("creates normalized boxes even when dragging in reverse", () => {
    const bounds = boxFromPoints({ x: 0.8, y: 0.7 }, { x: 0.2, y: 0.1 });
    expect(bounds.x).toBe(0.2);
    expect(bounds.y).toBe(0.1);
    expect(bounds.width).toBeCloseTo(0.6);
    expect(bounds.height).toBeCloseTo(0.6);
  });
});

describe("PDF annotation models", () => {
  it("associates markup annotations with their source page", () => {
    const annotation = createDraftAnnotation(
      "underline",
      { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.25 },
      7,
    );
    expect(annotation).toMatchObject({ kind: "underline", page: 7, x: 0.1, y: 0.2 });
    expect(isMeaningfulAnnotation(annotation)).toBe(true);
  });

  it("stores entered text only on text-box annotations", () => {
    const annotation = createDraftAnnotation(
      "text-box",
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.3 },
      2,
      "A local note",
    );
    expect(annotation).toMatchObject({
      kind: "text-box",
      text: "A local note",
      ...DEFAULT_TEXT_ANNOTATION_STYLE,
    });
    if (annotation.kind !== "text-box") throw new Error("Expected a text-box draft");
    expect(isMeaningfulAnnotation(annotation)).toBe(true);
    expect(isMeaningfulAnnotation({ ...annotation, text: "  " })).toBe(false);
  });

  it("stores custom text size and color with a text-box annotation", () => {
    const annotation = createDraftAnnotation(
      "text-box",
      { x: 0.1, y: 0.1 },
      { x: 0.6, y: 0.3 },
      4,
      "Styled note",
      { fontSize: 0.04, color: "#aa2200" },
    );
    expect(annotation).toMatchObject({
      kind: "text-box",
      page: 4,
      fontSize: 0.04,
      color: "#aa2200",
    });
  });

  it("appends freehand points without mutating the previous draft", () => {
    const draft = createDraftAnnotation(
      "freehand",
      { x: 0.1, y: 0.1 },
      { x: 0.1, y: 0.1 },
      1,
    );
    if (draft.kind !== "freehand") throw new Error("Expected a freehand draft");
    const updated = appendFreehandPoint(draft, { x: 0.2, y: 0.2 });
    expect(draft.points).toHaveLength(1);
    expect(updated.points).toHaveLength(2);
    expect(isMeaningfulAnnotation(updated)).toBe(true);
  });

  it("calculates line bounds and rejects zero-length drawings", () => {
    const line = createDraftAnnotation(
      "arrow",
      { x: 0.8, y: 0.2 },
      { x: 0.2, y: 0.6 },
      3,
    );
    const bounds = getAnnotationBounds(line);
    expect(bounds.x).toBe(0.2);
    expect(bounds.y).toBe(0.2);
    expect(bounds.width).toBeCloseTo(0.6);
    expect(bounds.height).toBeCloseTo(0.4);
    expect(isMeaningfulAnnotation(line)).toBe(true);
    const empty = createDraftAnnotation(
      "line",
      { x: 0.2, y: 0.2 },
      { x: 0.2, y: 0.2 },
      3,
    );
    expect(isMeaningfulAnnotation(empty)).toBe(false);
  });
});

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("image overlay validation", () => {
  it("detects supported image signatures", () => {
    expect(detectImageOverlayType(PNG_BYTES)).toBe("png");
    expect(detectImageOverlayType(JPEG_BYTES)).toBe("jpeg");
    expect(detectImageOverlayType(WEBP_BYTES)).toBe("webp");
    expect(detectImageOverlayType(new Uint8Array([0x47, 0x49, 0x46]))).toBeNull();
  });

  it("accepts only non-empty supported images within the size limit", () => {
    expect(validateImageOverlayFile(PNG_BYTES.length, PNG_BYTES))
      .toEqual({ ok: true, format: "png" });
    expect(validateImageOverlayFile(JPEG_BYTES.length, JPEG_BYTES))
      .toEqual({ ok: true, format: "jpeg" });
    expect(validateImageOverlayFile(WEBP_BYTES.length, WEBP_BYTES))
      .toEqual({ ok: true, format: "webp" });
    expect(validateImageOverlayFile(0, new Uint8Array()))
      .toMatchObject({ ok: false });
    expect(validateImageOverlayFile(IMAGE_OVERLAY_MAX_BYTES + 1, PNG_BYTES))
      .toMatchObject({ ok: false });
    expect(validateImageOverlayFile(5, new Uint8Array([0x47, 0x49, 0x46])))
      .toMatchObject({ ok: false });
  });

  it("requires a safe image data URL before an overlay is considered meaningful", () => {
    const image = createDraftAnnotation(
      "image",
      { x: 0.1, y: 0.1 },
      { x: 0.4, y: 0.4 },
      1,
      "",
      DEFAULT_TEXT_ANNOTATION_STYLE,
      { src: PNG_DATA_URL, name: "logo.png" },
    );
    expect(image).toMatchObject({
      kind: "image",
      src: PNG_DATA_URL,
      name: "logo.png",
      page: 1,
    });
    expect(isImageOverlaySource(PNG_DATA_URL)).toBe(true);
    expect(isImageOverlaySource("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isMeaningfulAnnotation(image)).toBe(true);
    if (image.kind !== "image") throw new Error("Expected an image overlay draft");
    expect(isMeaningfulAnnotation({ ...image, src: "" })).toBe(false);
  });
});

describe("annotation selection and transforms", () => {
  it("finds the topmost page annotation at a normalized point", () => {
    const rectangle = {
      ...createDraftAnnotation(
        "rectangle",
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.5 },
        1,
      ),
      id: 1,
    };
    const textBox = {
      ...createDraftAnnotation(
        "text-box",
        { x: 0.2, y: 0.2 },
        { x: 0.6, y: 0.4 },
        1,
        "Topmost",
      ),
      id: 2,
    };
    expect(findAnnotationAtPoint([rectangle, textBox], { x: 0.3, y: 0.3 })?.id).toBe(2);
    expect(findAnnotationAtPoint([textBox, rectangle], { x: 0.3, y: 0.3 })?.id).toBe(1);
    expect(findAnnotationAtPoint([rectangle, textBox], { x: 0.9, y: 0.9 })).toBeNull();
  });

  it("moves boxes and point annotations while keeping them inside the page", () => {
    const rectangle = createDraftAnnotation(
      "rectangle",
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.5 },
      1,
    );
    expect(getAnnotationBounds(moveAnnotation(rectangle, 0.2, -0.1))).toMatchObject({
      x: 0.4,
      y: 0.1,
      width: 0.3,
      height: 0.3,
    });
    const clamped = getAnnotationBounds(moveAnnotation(rectangle, 0.9, 0.9));
    expect(clamped.x).toBeCloseTo(0.7);
    expect(clamped.y).toBeCloseTo(0.7);

    const line = createDraftAnnotation(
      "line",
      { x: 0.1, y: 0.2 },
      { x: 0.4, y: 0.5 },
      1,
    );
    const movedLine = moveAnnotation(line, 0.2, 0.1);
    if (movedLine.kind !== "line") throw new Error("Expected a line");
    expect(movedLine.start.x).toBeCloseTo(0.3);
    expect(movedLine.start.y).toBeCloseTo(0.3);
    expect(movedLine.end.x).toBeCloseTo(0.6);
    expect(movedLine.end.y).toBeCloseTo(0.6);

    const freehand = createDraftAnnotation(
      "freehand",
      { x: 0.1, y: 0.1 },
      { x: 0.1, y: 0.1 },
      1,
    );
    if (freehand.kind !== "freehand") throw new Error("Expected a freehand draft");
    const movedFreehand = moveAnnotation(appendFreehandPoint(freehand, { x: 0.2, y: 0.3 }), 0.1, 0.1);
    if (movedFreehand.kind !== "freehand") throw new Error("Expected a freehand annotation");
    expect(movedFreehand.points).toHaveLength(2);
    expect(movedFreehand.points[0]?.x).toBeCloseTo(0.2);
    expect(movedFreehand.points[1]?.y).toBeCloseTo(0.4);
  });

  it("resizes box, line and freehand annotations from a new bounding frame", () => {
    const rectangle = createDraftAnnotation(
      "rectangle",
      { x: 0.2, y: 0.2 },
      { x: 0.4, y: 0.4 },
      1,
    );
    expect(getAnnotationBounds(resizeAnnotation(rectangle, {
      x: 0.1,
      y: 0.1,
      width: 0.5,
      height: 0.6,
    }))).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.6 });

    const line = createDraftAnnotation(
      "line",
      { x: 0.2, y: 0.2 },
      { x: 0.4, y: 0.4 },
      1,
    );
    const resizedLine = resizeAnnotation(line, {
      x: 0.1,
      y: 0.2,
      width: 0.8,
      height: 0.4,
    });
    if (resizedLine.kind !== "line") throw new Error("Expected a line");
    expect(resizedLine.start.x).toBeCloseTo(0.1);
    expect(resizedLine.end.x).toBeCloseTo(0.9);
    expect(resizedLine.start.y).toBeCloseTo(0.2);
    expect(resizedLine.end.y).toBeCloseTo(0.6);
  });

  it("clamps corner resizing to the page and a usable minimum size", () => {
    const bounds = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };
    const expanded = resizeBoundsFromHandle(bounds, "se", { x: 0.9, y: 0.8 });
    expect(expanded.x).toBeCloseTo(0.2);
    expect(expanded.y).toBeCloseTo(0.2);
    expect(expanded.width).toBeCloseTo(0.7);
    expect(expanded.height).toBeCloseTo(0.6);
    expect(resizeBoundsFromHandle(bounds, "nw", { x: 0.1, y: 0.1 }))
      .toMatchObject({ x: 0.1, y: 0.1 });
    const nw = resizeBoundsFromHandle(bounds, "nw", { x: 0.1, y: 0.1 });
    expect(nw.width).toBeCloseTo(0.5);
    expect(nw.height).toBeCloseTo(0.5);
    const minimum = resizeBoundsFromHandle(bounds, "se", { x: 0.21, y: 0.21 });
    expect(minimum.width).toBeCloseTo(0.01);
    expect(minimum.height).toBeCloseTo(0.01);
    const outside = resizeBoundsFromHandle(bounds, "nw", { x: -1, y: -1 });
    expect(outside.x).toBeCloseTo(0);
    expect(outside.y).toBeCloseTo(0);
    expect(outside.width).toBeCloseTo(0.6);
    expect(outside.height).toBeCloseTo(0.6);
  });
});

describe("annotation comments", () => {
  it("trims and requires comment text", () => {
    const comment = createAnnotationComment(1, 3, "  Check this figure  ", 7);
    expect(comment).toEqual({
      id: 1,
      page: 3,
      annotationId: 7,
      text: "Check this figure",
    });
    expect(isMeaningfulComment(comment)).toBe(true);
    expect(isMeaningfulComment({ ...comment, text: "   " })).toBe(false);
  });

  it("associates comments with pages and annotations without mutating state", () => {
    const empty = createEmptyAnnotationDocument();
    const pageComment = createAnnotationComment(1, 2, "Page-level note");
    const annotationComment = createAnnotationComment(2, 2, "Attached note", 9);
    const withPageComment = addAnnotationComment(empty, pageComment);
    const withBoth = addAnnotationComment(withPageComment, annotationComment);

    expect(empty.comments).toHaveLength(0);
    expect(withPageComment.comments).toEqual([pageComment]);
    expect(withBoth.comments).toEqual([pageComment, annotationComment]);
    expect(addAnnotationComment(withBoth, createAnnotationComment(3, 2, "  ")))
      .toBe(withBoth);
  });

  it("removes individual comments and all comments attached to a deleted annotation", () => {
    const pageComment = createAnnotationComment(1, 2, "Page note");
    const annotationComment = createAnnotationComment(2, 2, "Annotation note", 9);
    const unrelated = createAnnotationComment(3, 2, "Other annotation note", 10);
    const document = {
      annotations: [
        { ...createDraftAnnotation("rectangle", { x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, 2), id: 9 },
        { ...createDraftAnnotation("circle", { x: 0.3, y: 0.3 }, { x: 0.4, y: 0.4 }, 2), id: 10 },
      ],
      comments: [pageComment, annotationComment, unrelated],
    };

    expect(removeAnnotationComment(document, 2).comments).toEqual([pageComment, unrelated]);
    const withoutAnnotation = removeAnnotationFromDocument(document, 9);
    expect(withoutAnnotation.annotations.map((annotation) => annotation.id)).toEqual([10]);
    expect(withoutAnnotation.comments).toEqual([pageComment, unrelated]);
    expect(document.annotations).toHaveLength(2);
  });
});
