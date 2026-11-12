import { degrees, PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS, PdfInputError } from "./pdf-limits";
import { assertNoOverlaps, type PageRange } from "./split-pdf";

export type RotateProgress = { completed: number; total: number; label: string };

const normalizeAngle = (angle: number) => ((angle % 360) + 360) % 360;

async function loadRotateSource(bytes: Uint8Array) {
  if (bytes.byteLength === 0) throw new PdfInputError("empty", "The selected file is empty.");
  if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new PdfInputError("too-large", "The PDF exceeds the 50 MB file limit.");
  if (!checkPdfHeader(bytes)) throw new PdfInputError("wrong-signature", "This file does not have a PDF signature.");
  let source: PDFDocument;
  let pageCount: number;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
    pageCount = source.getPageCount();
  } catch {
    throw new PdfInputError("invalid-pdf", "This PDF could not be opened. It may be corrupt, encrypted, or unsupported.");
  }
  if (pageCount < 1 || pageCount > PDF_LIMITS.pages) throw new PdfInputError("too-many-pages", `The document must contain 1-${PDF_LIMITS.pages} pages.`);
  return { source, pageCount };
}

function validateDelta(delta: number) {
  if (delta !== 0 && delta !== 90 && delta !== 180 && delta !== 270) {
    throw new PdfInputError("invalid-pages", "Rotation must be 0, 90, 180, or 270 degrees.");
  }
}

export async function rotatePdfPages(
  bytes: Uint8Array,
  rotations: Readonly<Record<number, number>>,
  onProgress?: (progress: RotateProgress) => void,
) {
  const { source, pageCount } = await loadRotateSource(bytes);
  for (const [page, delta] of Object.entries(rotations)) {
    const pageNumber = Number(page);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      throw new PdfInputError("invalid-pages", `Page selection must stay within 1-${pageCount}.`);
    }
    validateDelta(delta);
  }

  const pages = source.getPages();
  const expected: number[] = [];
  pages.forEach((page, index) => {
    const delta = rotations[index + 1] ?? 0;
    const current = normalizeAngle(page.getRotation().angle);
    const next = normalizeAngle(current + delta);
    expected[index] = next;
    if (delta) page.setRotation(degrees(next));
    onProgress?.({ completed: index + 1, total: pageCount, label: `Rotated page ${index + 1} of ${pageCount}` });
  });

  const output = new Uint8Array(await source.save({ useObjectStreams: false }));
  if (output.byteLength > PDF_LIMITS.rotateOutputBytes) {
    output.fill(0);
    throw new PdfInputError("too-large", `The rotated PDF exceeds the ${PDF_LIMITS.rotateOutputBytes / 1024 / 1024} MB output limit.`);
  }
  try {
    const verified = await PDFDocument.load(output, { updateMetadata: false });
    if (verified.getPageCount() !== pageCount || !checkPdfHeader(output)) throw new PdfInputError("invalid-pdf", "The rotated PDF failed output validation.");
    verified.getPages().forEach((page, index) => {
      if (normalizeAngle(page.getRotation().angle) !== expected[index]) {
        throw new PdfInputError("invalid-pdf", "The rotated PDF failed orientation validation.");
      }
    });
    return { bytes: output, pageCount };
  } catch (error) {
    output.fill(0);
    throw error;
  }
}

export async function rotatePdfBuffer(
  bytes: Uint8Array,
  ranges: PageRange[],
  angle: 90 | 180 | 270,
  rotateAll = false,
  onProgress?: (progress: RotateProgress) => void,
) {
  validateDelta(angle);
  if (angle !== 90 && angle !== 180 && angle !== 270) throw new PdfInputError("invalid-pages", "Rotation must be 90, 180, or 270 degrees.");
  const { pageCount } = await loadRotateSource(bytes);
  const selected = new Set<number>();
  if (rotateAll) {
    for (let page = 1; page <= pageCount; page += 1) selected.add(page);
  } else {
    if (!ranges.length) throw new PdfInputError("invalid-pages", "Select at least one page to rotate.");
    assertNoOverlaps(ranges);
    for (const range of ranges) {
      if (range.first < 1 || range.last < range.first || range.last > pageCount) {
        throw new PdfInputError("invalid-pages", `Page selection must stay within 1-${pageCount}.`);
      }
      for (let page = range.first; page <= range.last; page += 1) selected.add(page);
    }
  }
  if (!selected.size) throw new PdfInputError("invalid-pages", "Select at least one page to rotate.");
  const rotations: Record<number, number> = {};
  for (const page of selected) rotations[page] = angle;
  return rotatePdfPages(bytes, rotations, onProgress);
}
