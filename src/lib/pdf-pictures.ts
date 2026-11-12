import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export type PdfPicture = {
  page: number;
  dataUrl: string;
  mime: "image/jpeg" | "image/png";
  width: number;
  height: number;
  /** Left edge in PDF points, from the left of the page. */
  x: number;
  /** Bottom edge in PDF points, from the bottom of the page. */
  y: number;
  boxWidth: number;
  boxHeight: number;
  pageWidth: number;
  pageHeight: number;
  /** True when the picture covers most of the page, e.g. a scan or background. */
  fullPage: boolean;
  /** Fraction of the page area covered by this picture. */
  coverage: number;
};

export type PdfPageImage = {
  page: number;
  dataUrl: string;
  mime: "image/png";
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
};

export type PdfPagePictureAnalysis = {
  page: number;
  hasImageOps: boolean;
  fullPage: boolean;
  coverage: number;
  boxes: number;
  unplaced: number;
};

export type PdfPictureExtraction = {
  pictures: PdfPicture[];
  pages: PdfPagePictureAnalysis[];
};

type PictureBox = { x: number; y: number; width: number; height: number; coverage: number; fullPage: boolean };
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const RENDER_SCALE = 1.5;
const MAX_PICTURE_WIDTH = 1100;
const MIN_PICTURE_POINTS = 3;
const FULL_PAGE_COVERAGE = 0.78;
const MAX_PICTURES_PER_PAGE = 50;

function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function transformPoint(matrix: Matrix, x: number, y: number) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}

/**
 * Converts the unit square painted by a PDF image operator into a top-level
 * page box. PDF images are always painted into a unit square transformed by
 * the current content-stream matrix; the viewport transform handles page
 * rotation and the y-axis flip.
 */
export function pictureBoxFromTransform(
  ctm: Matrix,
  viewportTransform: Matrix,
  pageWidth: number,
  pageHeight: number,
): PictureBox {
  const transformed = multiply(viewportTransform, ctm);
  const corners = [
    transformPoint(transformed, 0, 0),
    transformPoint(transformed, 1, 0),
    transformPoint(transformed, 0, 1),
    transformPoint(transformed, 1, 1),
  ];
  const minX = Math.min(...corners.map((point) => point.x));
  const maxX = Math.max(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxY = Math.max(...corners.map((point) => point.y));
  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  const coverage = pageWidth > 0 && pageHeight > 0 ? Math.min(1, (width * height) / (pageWidth * pageHeight)) : 0;
  return {
    x: minX,
    y: pageHeight - maxY,
    width,
    height,
    coverage,
    fullPage: coverage >= FULL_PAGE_COVERAGE,
  };
}

function imageBoxesFromOperators(
  operators: { fnArray: number[]; argsArray: unknown[][] },
  pdfjs: typeof import("pdfjs-dist"),
  viewport: { transform: number[]; width: number; height: number },
): { boxes: PictureBox[]; hasImageOps: boolean; unplaced: number } {
  const imageOps = new Set([
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintSolidColorImageMask,
  ]);
  const groupImageOps = new Set([
    pdfjs.OPS.paintInlineImageXObjectGroup,
    pdfjs.OPS.paintImageMaskXObjectGroup,
    pdfjs.OPS.paintImageXObjectRepeat,
    pdfjs.OPS.paintImageMaskXObjectRepeat,
  ]);
  const viewportTransform = viewport.transform as Matrix;
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  let hasImageOps = false;
  let unplaced = 0;
  const boxes: PictureBox[] = [];

  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const fn = operators.fnArray[index];
    const args = operators.argsArray[index] ?? [];
    if (fn === pdfjs.OPS.save) {
      stack.push([...ctm] as Matrix);
      continue;
    }
    if (fn === pdfjs.OPS.restore) {
      ctm = stack.pop() ?? IDENTITY;
      continue;
    }
    if (fn === pdfjs.OPS.transform && args.length === 6) {
      ctm = multiply(ctm, args.slice(0, 6) as Matrix);
      continue;
    }
    if (fn === pdfjs.OPS.paintFormXObjectBegin) {
      stack.push([...ctm] as Matrix);
      const matrix = args[0];
      if (Array.isArray(matrix) && matrix.length === 6) ctm = multiply(ctm, matrix as Matrix);
      continue;
    }
    if (fn === pdfjs.OPS.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY;
      continue;
    }
    if (fn === pdfjs.OPS.beginAnnotation) {
      stack.push([...ctm] as Matrix);
      continue;
    }
    if (fn === pdfjs.OPS.endAnnotation) {
      ctm = stack.pop() ?? IDENTITY;
      continue;
    }
    if (fn === pdfjs.OPS.paintImageXObjectRepeat) {
      hasImageOps = true;
      const scaleX = typeof args[1] === "number" ? args[1] : 1;
      const scaleY = typeof args[2] === "number" ? args[2] : 1;
      const positions = Array.isArray(args[3]) ? (args[3] as number[]) : [];
      if (!positions.length) {
        unplaced += 1;
        continue;
      }
      for (let position = 0; position + 1 < positions.length; position += 2) {
        const repeat = multiply(ctm, [scaleX, 0, 0, scaleY, positions[position], positions[position + 1]]);
        const box = pictureBoxFromTransform(repeat, viewportTransform, viewport.width, viewport.height);
        if (box.width >= MIN_PICTURE_POINTS && box.height >= MIN_PICTURE_POINTS) boxes.push(box);
      }
      continue;
    }
    if (groupImageOps.has(fn)) {
      hasImageOps = true;
      const map = args.find((value) => Array.isArray(value) && value.every((item) => item && typeof item === "object" && "transform" in item)) as
        | Array<{ transform?: number[] }>
        | undefined;
      if (!map?.length) {
        unplaced += 1;
        continue;
      }
      for (const entry of map) {
        if (!Array.isArray(entry.transform) || entry.transform.length !== 6) {
          unplaced += 1;
          continue;
        }
        const box = pictureBoxFromTransform(multiply(ctm, entry.transform as Matrix), viewportTransform, viewport.width, viewport.height);
        if (box.width >= MIN_PICTURE_POINTS && box.height >= MIN_PICTURE_POINTS) boxes.push(box);
      }
      continue;
    }
    if (!imageOps.has(fn)) continue;
    hasImageOps = true;
    const box = pictureBoxFromTransform(ctm, viewportTransform, viewport.width, viewport.height);
    if (box.width >= MIN_PICTURE_POINTS && box.height >= MIN_PICTURE_POINTS) boxes.push(box);
    else unplaced += 1;
  }

  const unique = new Map<string, PictureBox>();
  for (const box of boxes) {
    const key = `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`;
    if (!unique.has(key)) unique.set(key, box);
  }
  return { boxes: [...unique.values()], hasImageOps, unplaced };
}

async function paintPage(page: PDFPageProxy, scale: number, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Conversion cancelled", "AbortError");
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const task = page.render({ canvas, canvasContext: context, viewport });
  const abort = () => task.cancel();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await task.promise;
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Conversion cancelled", "AbortError");
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  return { canvas, pageHeight: page.getViewport({ scale: 1 }).height };
}

function cropPicture(source: HTMLCanvasElement, picture: PictureBox, pageHeight: number) {
  const left = Math.max(0, Math.round(picture.x * RENDER_SCALE) - 2);
  const top = Math.max(0, Math.round((pageHeight - picture.y - picture.height) * RENDER_SCALE) - 2);
  const width = Math.min(source.width - left, Math.round(picture.width * RENDER_SCALE) + 4);
  const height = Math.min(source.height - top, Math.round(picture.height * RENDER_SCALE) + 4);
  if (width < 8 || height < 8) return null;
  const scale = width > MAX_PICTURE_WIDTH ? MAX_PICTURE_WIDTH / width : 1;
  const target = document.createElement("canvas");
  target.width = Math.max(1, Math.round(width * scale));
  target.height = Math.max(1, Math.round(height * scale));
  const context = target.getContext("2d", { alpha: false });
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, left, top, width, height, 0, 0, target.width, target.height);
  const dataUrl = target.toDataURL("image/jpeg", 0.86);
  const output = { dataUrl, width: target.width, height: target.height };
  target.width = 0;
  target.height = 0;
  return output;
}

export async function extractPdfPictureData(
  document: PDFDocumentProxy,
  options: {
    pages?: readonly number[];
    signal?: AbortSignal;
    onProgress?: (completed: number, total: number) => void;
    /** Full-page scans/backgrounds are skipped when false. Defaults to true. */
    includeFullPage?: boolean;
    maxPicturesPerPage?: number;
  } = {},
): Promise<PdfPictureExtraction> {
  const pdfjs = await import("pdfjs-dist");
  const pageNumbers = options.pages ?? Array.from({ length: document.numPages }, (_, index) => index + 1);
  const pictures: PdfPicture[] = [];
  const pages: PdfPagePictureAnalysis[] = [];
  const includeFullPage = options.includeFullPage !== false;
  const maxPictures = Math.max(1, options.maxPicturesPerPage ?? MAX_PICTURES_PER_PAGE);

  for (let index = 0; index < pageNumbers.length; index += 1) {
    if (options.signal?.aborted) throw new DOMException("Conversion cancelled", "AbortError");
    const pageNumber = pageNumbers[index];
    const page = await document.getPage(pageNumber);
    try {
      const baseViewport = page.getViewport({ scale: 1 });
      const operators = await page.getOperatorList();
      const { boxes, hasImageOps, unplaced } = imageBoxesFromOperators(
        { fnArray: operators.fnArray, argsArray: operators.argsArray as unknown[][] },
        pdfjs,
        baseViewport,
      );
      const fullPageBoxes = boxes.filter((box) => box.fullPage);
      const contentBoxes = boxes.filter((box) => !box.fullPage);
      const coverage = boxes.reduce((total, box) => total + box.coverage, 0);
      const selected = (includeFullPage ? boxes : contentBoxes)
        .sort((left, right) => right.coverage - left.coverage)
        .slice(0, maxPictures);
      const dropped = (includeFullPage ? boxes.length : contentBoxes.length) - selected.length;
      pages.push({
        page: pageNumber,
        hasImageOps,
        fullPage: fullPageBoxes.length > 0,
        coverage: Math.min(1, coverage),
        boxes: boxes.length,
        unplaced: unplaced + Math.max(0, dropped),
      });

      if (selected.length) {
        const painted = await paintPage(page, RENDER_SCALE, options.signal);
        if (painted) {
          const sourceHeight = page.getViewport({ scale: 1 }).height;
          for (const box of selected) {
            const cropped = cropPicture(painted.canvas, box, sourceHeight);
            if (!cropped) continue;
            pictures.push({
              page: pageNumber,
              dataUrl: cropped.dataUrl,
              mime: "image/jpeg",
              width: cropped.width,
              height: cropped.height,
              x: box.x,
              y: box.y,
              boxWidth: box.width,
              boxHeight: box.height,
              pageWidth: baseViewport.width,
              pageHeight: baseViewport.height,
              fullPage: box.fullPage,
              coverage: box.coverage,
            });
          }
          painted.canvas.width = 0;
          painted.canvas.height = 0;
        }
      }
    } finally {
      page.cleanup();
    }
    options.onProgress?.(index + 1, pageNumbers.length);
  }
  return { pictures, pages };
}

export async function extractPdfPictures(
  document: PDFDocumentProxy,
  options: {
    pages?: readonly number[];
    signal?: AbortSignal;
    onProgress?: (completed: number, total: number) => void;
    includeFullPage?: boolean;
  } = {},
): Promise<PdfPicture[]> {
  return (await extractPdfPictureData(document, options)).pictures;
}

export async function renderPdfPageImages(
  document: PDFDocumentProxy,
  pageNumbers: readonly number[],
  options: { scale?: number; signal?: AbortSignal; onProgress?: (completed: number, total: number) => void } = {},
): Promise<PdfPageImage[]> {
  const scale = options.scale ?? 1.35;
  const output: PdfPageImage[] = [];
  for (let index = 0; index < pageNumbers.length; index += 1) {
    if (options.signal?.aborted) throw new DOMException("Conversion cancelled", "AbortError");
    const pageNumber = pageNumbers[index];
    const page = await document.getPage(pageNumber);
    try {
      const baseViewport = page.getViewport({ scale: 1 });
      const painted = await paintPage(page, scale, options.signal);
      if (!painted) throw new Error("This browser could not create a PDF page canvas.");
      output.push({
        page: pageNumber,
        dataUrl: painted.canvas.toDataURL("image/png"),
        mime: "image/png",
        width: painted.canvas.width,
        height: painted.canvas.height,
        pageWidth: baseViewport.width,
        pageHeight: baseViewport.height,
      });
      painted.canvas.width = 0;
      painted.canvas.height = 0;
    } finally {
      page.cleanup();
    }
    options.onProgress?.(index + 1, pageNumbers.length);
  }
  return output;
}

export function dataUrlToImageBytes(dataUrl: string): { bytes: Uint8Array; format: "png" | "jpeg"; mime: string } {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) throw new Error("A rendered picture did not have a supported data URL.");
  const mime = match[1].toLowerCase();
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { bytes, format: mime === "image/png" ? "png" : "jpeg", mime };
}

async function withPdfDocument<T>(
  file: Pick<File, "size" | "arrayBuffer">,
  signal: AbortSignal | undefined,
  work: (document: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  if (!file.size) throw new Error("The selected file is empty.");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const buffer = await file.arrayBuffer();
  if (signal?.aborted) {
    new Uint8Array(buffer).fill(0);
    throw new DOMException("Conversion cancelled", "AbortError");
  }
  const data = new Uint8Array(buffer);
  const loading = pdfjs.getDocument({ data });
  const abort = () => { void (loading as PDFDocumentLoadingTask).destroy(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const document = await loading.promise;
    return await work(document);
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Conversion cancelled", "AbortError");
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    try { await loading.destroy(); } catch { /* already destroyed */ }
    if (data.byteLength) data.fill(0);
  }
}

export async function extractPdfPictureDataFromFile(
  file: Pick<File, "size" | "arrayBuffer">,
  options: {
    pages?: readonly number[];
    signal?: AbortSignal;
    onProgress?: (completed: number, total: number) => void;
    includeFullPage?: boolean;
  } = {},
) {
  return withPdfDocument(file, options.signal, (document) => extractPdfPictureData(document, options));
}

export async function extractPdfPicturesFromFile(
  file: Pick<File, "size" | "arrayBuffer">,
  options: { pages?: readonly number[]; signal?: AbortSignal; onProgress?: (completed: number, total: number) => void; includeFullPage?: boolean } = {},
) {
  return (await extractPdfPictureDataFromFile(file, options)).pictures;
}

export async function renderPdfFilePageImages(
  file: Pick<File, "size" | "arrayBuffer">,
  pageNumbers: readonly number[],
  options: { scale?: number; signal?: AbortSignal; onProgress?: (completed: number, total: number) => void } = {},
) {
  return withPdfDocument(file, options.signal, (document) => renderPdfPageImages(document, pageNumbers, options));
}
