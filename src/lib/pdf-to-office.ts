import { baseName } from "./office-convert";
import {
  OFFICE_LIMITS,
  buildDocxDocument,
  buildXlsxWorkbook,
  validateDocxDocument,
  validateXlsxWorkbook,
  xmlEscape,
  type DocxContentBlock,
  type XlsxSheet,
} from "./office-formats";
import { dataUrlToImageBytes, extractPdfPictureDataFromFile, renderPdfFilePageImages, type PdfPagePictureAnalysis, type PdfPicture } from "./pdf-pictures";
import { mergeOcrLines } from "./pdf-ocr";
import { extractPdfStructure, type PdfPageBlock, type PdfPageStructure, type PdfStructure } from "./pdf-structured";

export type PdfOfficeFormat = "docx" | "xlsx";
export type PdfOfficeMode = "editable" | "visual";

export type PdfOfficeSettings = {
  format: PdfOfficeFormat;
  mode: PdfOfficeMode;
  pages: string;
  includeTables: boolean;
  includePictures: boolean;
  pageBreaks: boolean;
  outputName?: string;
  /** OCR image-only pages instead of failing. Off by default. */
  ocrScannedPages?: boolean;
};

export type PdfOfficeStats = {
  pages: number;
  textPages: number;
  scannedPages: number;
  blankPages: number;
  ocrPages: number;
  paragraphs: number;
  headings: number;
  tables: number;
  pictures: number;
  skippedFullPageImages: number;
  unplacedImages: number;
  warnings: string[];
};

export type PdfOfficeResult = {
  bytes: Uint8Array;
  fileName: string;
  mime: string;
  detail: string;
  stats: PdfOfficeStats;
};

export type PdfOfficeErrorCode =
  | "scanned-pages"
  | "too-many-ocr-pages"
  | "ocr-unavailable"
  | "ocr-failed"
  | "no-content"
  | "invalid-output"
  | "too-large";

export class PdfOfficeError extends Error {
  constructor(
    public readonly code: PdfOfficeErrorCode,
    message: string,
    public readonly pages: number[] = [],
  ) {
    super(message);
    this.name = "PdfOfficeError";
  }
}

const OFFICE_MIME: Record<PdfOfficeFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const OUTPUT_LIMIT = 30 * 1024 * 1024;
const MAX_OCR_PAGES = 20;
const MAX_VISUAL_PAGES = 100;

function safeOfficeName(name: string | undefined, fallback: string) {
  const value = baseName(name?.trim() || fallback);
  return value || "document";
}

function pageLabelList(pages: readonly number[]) {
  return pages.length ? pages.join(", ") : "none";
}

function pageWidth(page: PdfPageStructure) {
  return Number.isFinite(page.width) && page.width > 0 ? page.width : 612;
}

function pageHeight(page: PdfPageStructure) {
  return Number.isFinite(page.height) && page.height > 0 ? page.height : 792;
}

type PositionedBlock = { y: number; order: number; block: DocxContentBlock };

function textBlockToDocx(block: Exclude<PdfPageBlock, { kind: "table" }>): DocxContentBlock {
  const indent = block.indent ? Math.round(block.indent * 20) : undefined;
  if (block.kind === "heading") {
    return {
      kind: "heading",
      text: block.text,
      level: block.level ?? 2,
      alignment: block.alignment,
      indent,
      bold: true,
    };
  }
  if (block.kind === "list") {
    return { kind: "list", text: block.text, indent: indent ?? 360 };
  }
  return {
    kind: "paragraph",
    text: block.text,
    alignment: block.alignment,
    indent,
    bold: block.bold,
    italic: block.italic,
  };
}

function positionedPageBlocks(
  page: PdfPageStructure,
  settings: PdfOfficeSettings,
  pictures: readonly PdfPicture[],
  ocrText: string | undefined,
): PositionedBlock[] {
  const positioned: PositionedBlock[] = [];
  let order = 0;
  for (const block of page.blocks) {
    if (block.kind === "table") {
      if (settings.includeTables) {
        positioned.push({
          y: block.y,
          order: order++,
          block: { kind: "table", rows: block.table.rows, header: block.table.header },
        });
      } else {
        positioned.push({
          y: block.y,
          order: order++,
          block: { kind: "paragraph", text: block.table.rows.map((row) => row.join("  |  ")).join("\n") },
        });
      }
      continue;
    }
    positioned.push({ y: block.y, order: order++, block: textBlockToDocx(block) });
  }

  if (ocrText?.trim()) {
    const paragraphs = ocrText
      .replace(/\r\n?/g, "\n")
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    let y = pageHeight(page) - 72;
    for (const paragraph of paragraphs) {
      positioned.push({
        y,
        order: order++,
        block: { kind: "paragraph", text: paragraph, italic: false, spaceAfter: 120 },
      });
      y -= 18;
    }
  }

  if (settings.includePictures) {
    for (const picture of pictures) {
      if (picture.fullPage) continue;
      const converted = dataUrlToImageBytes(picture.dataUrl);
      positioned.push({
        y: picture.y,
        order: order++,
        block: {
          kind: "image",
          bytes: converted.bytes,
          format: converted.format,
          // DOCX dimensions are interpreted at 96 DPI. Convert the PDF box
          // measured in points so the image keeps its source display size.
          width: Math.max(1, picture.boxWidth * (96 / 72)),
          height: Math.max(1, picture.boxHeight * (96 / 72)),
          maxWidth: Math.max(72, pageWidth(page) - 72),
          maxHeight: Math.max(72, pageHeight(page) - 72),
          alt: `Picture from PDF page ${page.page}`,
          anchor: settings.pageBreaks ? {
            x: picture.x,
            y: picture.y,
            width: Math.max(1, picture.boxWidth),
            height: Math.max(1, picture.boxHeight),
            pageWidth: picture.pageWidth,
            pageHeight: picture.pageHeight,
            behindText: true,
          } : undefined,
        },
      });
    }
  }

  const images = positioned.filter(({ block }) => block.kind === "image");
  const flow = positioned.filter(({ block }) => block.kind !== "image").sort((left, right) => right.y - left.y || left.order - right.order);
  return [...images, ...flow];
}

function addPageBoundary(blocks: DocxContentBlock[], previous: PdfPageStructure, next: PdfPageStructure, pageBreaks: boolean) {
  if (!pageBreaks) return;
  const previousWidth = pageWidth(previous);
  const previousHeight = pageHeight(previous);
  const nextWidth = pageWidth(next);
  const nextHeight = pageHeight(next);
  if (Math.abs(previousWidth - nextWidth) > 0.5 || Math.abs(previousHeight - nextHeight) > 0.5) {
    blocks.push({ kind: "sectionBreak", pageWidth: previousWidth, pageHeight: previousHeight });
  } else {
    blocks.push({ kind: "pageBreak" });
  }
}

function countPageKinds(
  structure: PdfStructure,
  analysisByPage: ReadonlyMap<number, PdfPagePictureAnalysis>,
  ocrPages: readonly number[],
) {
  const scannedPages: number[] = [];
  const blankPages: number[] = [];
  const textPages: number[] = [];
  for (const page of structure.pages) {
    if (page.text.trim()) {
      textPages.push(page.page);
      continue;
    }
    const analysis = analysisByPage.get(page.page);
    if (analysis?.hasImageOps || analysis?.fullPage) scannedPages.push(page.page);
    else blankPages.push(page.page);
  }
  return {
    textPages,
    scannedPages,
    blankPages,
    ocrPages: [...new Set(ocrPages)],
  };
}

function auditEditableDocx(
  bytes: Uint8Array,
  structure: PdfStructure,
  expectedPictures: number,
  expectedTables: number,
  ocrTextByPage: ReadonlyMap<number, string>,
) {
  const { xml, entries } = validateDocxDocument(bytes);
  const media = Object.keys(entries).filter((name) => name.startsWith("word/media/"));
  if (media.length < expectedPictures) {
    throw new PdfOfficeError("invalid-output", "The generated Word file is missing one or more embedded content pictures.");
  }
  const tableCount = (xml.match(/<w:tbl>/g) ?? []).length;
  if (tableCount < expectedTables) {
    throw new PdfOfficeError("invalid-output", "The generated Word file is missing one or more detected tables.");
  }
  for (const page of structure.pages) {
    const markers: string[] = [];
    for (const block of page.blocks) {
      if (block.kind === "table") {
        for (const value of block.table.rows.flat()) {
          if (value.trim().length >= 4) markers.push(value.trim().slice(0, 80));
        }
      } else if (block.text.trim().length >= 4) {
        markers.push(block.text.trim().slice(0, 80));
      }
    }
    const ocr = ocrTextByPage.get(page.page);
    if (ocr?.trim()) {
      const firstParagraph = ocr.split(/\n{2,}/)[0].replace(/\s+/g, " ").trim();
      if (firstParagraph) markers.push(firstParagraph.slice(0, 80));
    }
    for (const marker of markers) {
      if (!xml.includes(xmlEscape(marker))) {
        throw new PdfOfficeError("invalid-output", `The generated Word file is missing content from page ${page.page}.`);
      }
    }
  }

  const maxPageWidth = Math.max(72, ...structure.pages.map((page) => pageWidth(page)));
  const maxPageHeight = Math.max(72, ...structure.pages.map((page) => pageHeight(page)));
  const pageArea = maxPageWidth * maxPageHeight;
  const contentWidth = Math.max(1, maxPageWidth - 72);
  const contentHeight = Math.max(1, maxPageHeight - 72);
  for (const match of xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)) {
    const width = Number(match[1]) / 12700;
    const height = Number(match[2]) / 12700;
    if (width * height > pageArea * 0.95 || (width >= contentWidth * 0.9 && height >= contentHeight * 0.9)) {
      throw new PdfOfficeError(
        "invalid-output",
        "Editable Word output contained an unexpected page-sized image. The conversion was stopped instead of returning a screenshot-based document.",
      );
    }
  }
}

async function buildEditableWord(
  structure: PdfStructure,
  settings: PdfOfficeSettings,
  pictures: readonly PdfPicture[],
  analysisByPage: ReadonlyMap<number, PdfPagePictureAnalysis>,
  ocrTextByPage: ReadonlyMap<number, string>,
  onProgress: (message: string) => void,
): Promise<Omit<PdfOfficeResult, "fileName" | "mime">> {
  const picturesByPage = new Map<number, PdfPicture[]>();
  for (const picture of pictures) {
    const list = picturesByPage.get(picture.page) ?? [];
    list.push(picture);
    picturesByPage.set(picture.page, list);
  }

  const blocks: DocxContentBlock[] = [];
  let paragraphs = 0;
  let headings = 0;
  let tables = 0;
  let pictureCount = 0;
  let skippedFullPageImages = 0;
  let unplacedImages = 0;
  const warnings: string[] = [];

  for (let index = 0; index < structure.pages.length; index += 1) {
    const page = structure.pages[index];
    if (index > 0) addPageBoundary(blocks, structure.pages[index - 1], page, settings.pageBreaks);
    const pageAnalysis = analysisByPage.get(page.page);
    if (pageAnalysis?.fullPage) skippedFullPageImages += 1;
    if (pageAnalysis?.unplaced) unplacedImages += pageAnalysis.unplaced;
    const pageBlocks = positionedPageBlocks(page, settings, picturesByPage.get(page.page) ?? [], ocrTextByPage.get(page.page));
    for (const { block } of pageBlocks) {
      if (block.kind === "heading") headings += 1;
      else if (block.kind === "paragraph" || block.kind === "list") paragraphs += 1;
      else if (block.kind === "table") tables += 1;
      else if (block.kind === "image") pictureCount += 1;
      blocks.push(block);
    }
  }

  if (skippedFullPageImages) {
    warnings.push(`${skippedFullPageImages} full-page background or scan image(s) were not inserted in editable mode.`);
  }
  if (unplacedImages) {
    warnings.push(`${unplacedImages} image(s) could not be placed and were skipped rather than replacing a page with a screenshot.`);
  }
  const blankPages = structure.pages.filter((page) => !page.text.trim() && !analysisByPage.get(page.page)?.hasImageOps).map((page) => page.page);
  if (blankPages.length) warnings.push(`Blank page(s) preserved: ${pageLabelList(blankPages)}.`);

  if (!blocks.length) throw new PdfOfficeError("no-content", "No selectable content could be converted.");
  onProgress("Writing the Word document…");
  const lastPage = structure.pages[structure.pages.length - 1];
  const bytes = buildDocxDocument(
    blocks,
    structure.metadata.title || safeOfficeName(settings.outputName, "document"),
    { width: pageWidth(lastPage), height: pageHeight(lastPage) },
  );
  validateDocxDocument(bytes);
  if (bytes.byteLength > OUTPUT_LIMIT) {
    throw new PdfOfficeError("too-large", "The generated Word file exceeds the 30 MB output limit. Convert fewer pages or disable pictures.");
  }
  const expectedTables = settings.includeTables
    ? structure.pages.reduce((total, page) => total + page.tables.length, 0)
    : 0;
  auditEditableDocx(bytes, structure, pictureCount, expectedTables, ocrTextByPage);

  const kinds = countPageKinds(structure, analysisByPage, [...ocrTextByPage.keys()]);
  return {
    bytes,
    detail: `${structure.selectedPages.length} page(s): ${kinds.textPages.length} text page(s), ${kinds.scannedPages.length} image-only page(s), ${kinds.ocrPages.length} OCR page(s), ${paragraphs} paragraph(s), ${headings} heading(s), ${tables} table(s)${pictureCount ? `, ${pictureCount} content picture(s)` : ""}.`,
    stats: {
      pages: structure.selectedPages.length,
      textPages: kinds.textPages.length,
      scannedPages: kinds.scannedPages.length,
      blankPages: kinds.blankPages.length,
      ocrPages: kinds.ocrPages.length,
      paragraphs,
      headings,
      tables,
      pictures: pictureCount,
      skippedFullPageImages,
      unplacedImages,
      warnings,
    },
  };
}

async function buildVisualWord(
  file: File,
  structure: PdfStructure,
  onProgress: (message: string) => void,
  signal: AbortSignal,
): Promise<Omit<PdfOfficeResult, "fileName" | "mime">> {
  if (structure.pages.length > MAX_VISUAL_PAGES) {
    throw new PdfOfficeError("too-large", `Visual Word mode is limited to ${MAX_VISUAL_PAGES} pages at a time. Choose a page range and convert in batches.`);
  }
  onProgress("Rendering page images for the visual Word document…");
  const pageImages = await renderPdfFilePageImages(file, structure.selectedPages, {
    signal,
    scale: 1.5,
    onProgress: (completed, total) => onProgress(`Rendering page images ${completed} of ${total}…`),
  });
  if (pageImages.length !== structure.pages.length) {
    throw new PdfOfficeError("invalid-output", "The visual Word renderer did not render every selected page.");
  }
  const blocks: DocxContentBlock[] = [];
  for (let index = 0; index < structure.pages.length; index += 1) {
    const page = structure.pages[index];
    if (index > 0) addPageBoundary(blocks, structure.pages[index - 1], page, true);
    const image = pageImages[index];
    if (!image) throw new PdfOfficeError("invalid-output", `Page ${page.page} could not be rendered.`);
    const converted = dataUrlToImageBytes(image.dataUrl);
    blocks.push({
      kind: "image",
      bytes: converted.bytes,
      format: converted.format,
      width: image.width,
      height: image.height,
      maxWidth: Math.max(72, pageWidth(page) - 36),
      maxHeight: Math.max(72, pageHeight(page) - 36),
      alt: `PDF page ${page.page}`,
    });
  }
  onProgress("Writing the visual Word document…");
  const lastPage = structure.pages[structure.pages.length - 1];
  const bytes = buildDocxDocument(
    blocks,
    structure.metadata.title || safeOfficeName(undefined, file.name),
    { width: pageWidth(lastPage), height: pageHeight(lastPage) },
  );
  const { entries } = validateDocxDocument(bytes);
  const media = Object.keys(entries).filter((name) => name.startsWith("word/media/"));
  if (media.length !== structure.pages.length) {
    throw new PdfOfficeError("invalid-output", "The visual Word file does not contain one picture per selected page.");
  }
  if (bytes.byteLength > OUTPUT_LIMIT) {
    throw new PdfOfficeError("too-large", "The generated visual Word file exceeds the 30 MB output limit. Convert fewer pages.");
  }
  return {
    bytes,
    detail: `${structure.selectedPages.length} page(s) embedded as page pictures in visual mode. The document is not editable.`,
    stats: {
      pages: structure.selectedPages.length,
      textPages: 0,
      scannedPages: structure.pages.filter((page) => !page.text.trim()).length,
      blankPages: 0,
      ocrPages: 0,
      paragraphs: 0,
      headings: 0,
      tables: 0,
      pictures: structure.pages.length,
      skippedFullPageImages: 0,
      unplacedImages: 0,
      warnings: ["Visual Word contains page pictures and is not editable."],
    },
  };
}

async function ocrScannedPages(
  file: File,
  pages: readonly number[],
  signal: AbortSignal,
  onProgress: (message: string) => void,
): Promise<Map<number, string>> {
  if (pages.length > MAX_OCR_PAGES) {
    throw new PdfOfficeError("too-many-ocr-pages", `OCR is limited to ${MAX_OCR_PAGES} pages at a time. Choose a smaller page range.`, [...pages]);
  }
  onProgress("Rendering image-only pages for OCR…");
  const images = await renderPdfFilePageImages(file, pages, {
    scale: 2,
    signal,
    onProgress: (completed, total) => onProgress(`Rendering page for OCR ${completed} of ${total}…`),
  });
  if (images.length !== pages.length) throw new PdfOfficeError("ocr-failed", "Some image-only pages could not be rendered for OCR.", [...pages]);

  let worker: { recognize: (image: Blob) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> } | null = null;
  try {
    onProgress("Loading the OCR engine (about 15 MB on first use)…");
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker("eng");
    const output = new Map<number, string>();
    for (let index = 0; index < images.length; index += 1) {
      if (signal.aborted) throw new DOMException("Conversion cancelled", "AbortError");
      const page = pages[index];
      const image = images[index];
      const converted = dataUrlToImageBytes(image.dataUrl);
      const blob = new Blob([converted.bytes as unknown as BlobPart], { type: converted.mime });
      onProgress(`Recognising text on page ${page} (${index + 1} of ${images.length})…`);
      const result = await worker.recognize(blob);
      converted.bytes.fill(0);
      const text = mergeOcrLines(result.data.text);
      if (!text.trim()) {
        throw new PdfOfficeError("ocr-failed", `OCR did not recognise any text on page ${page}. The page may be blank or too low quality.`, [page]);
      }
      output.set(page, text);
    }
    return output;
  } catch (error) {
    if (error instanceof PdfOfficeError) throw error;
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw new DOMException("Conversion cancelled", "AbortError");
    throw new PdfOfficeError("ocr-unavailable", `OCR could not run: ${error instanceof Error ? error.message : "unknown OCR error"}. Try Visual Word or a smaller page range.`, [...pages]);
  } finally {
    if (worker) await worker.terminate().catch(() => undefined);
  }
}

async function buildWorkbook(
  structure: PdfStructure,
  settings: PdfOfficeSettings,
): Promise<Omit<PdfOfficeResult, "fileName" | "mime">> {
  const sheets: XlsxSheet[] = [];
  let tableIndex = 0;
  let tables = 0;
  let rows = 0;
  for (const page of structure.pages) {
    for (const table of page.tables) {
      tableIndex += 1;
      tables += 1;
      const tableRows = table.rows.slice(0, OFFICE_LIMITS.maxRows);
      rows += tableRows.length;
      sheets.push({
        name: `Table ${tableIndex}`,
        rows: tableRows,
        header: table.header,
        freezeHeader: table.header,
      });
      if (sheets.length >= 40) break;
    }
  }

  const textRows: string[][] = [["Page", "Extracted content"]];
  let paragraphs = 0;
  let headings = 0;
  for (const page of structure.pages) {
    for (const block of page.blocks) {
      if (block.kind === "table") {
        textRows.push([String(page.page), block.table.rows.map((row) => row.join(" | ")).join(" / ")]);
        continue;
      }
      if (!block.text.trim()) continue;
      if (block.kind === "heading") headings += 1;
      else paragraphs += 1;
      textRows.push([String(page.page), block.text]);
    }
  }
  if (textRows.length > 1) {
    sheets.push({ name: "Extracted text", rows: textRows.slice(0, OFFICE_LIMITS.maxRows), header: true, freezeHeader: true });
  }
  if (!sheets.length) throw new PdfOfficeError("no-content", "No selectable text or table structure was found. Scanned PDFs need OCR first.");
  const bytes = buildXlsxWorkbook(sheets, structure.metadata.title || safeOfficeName(settings.outputName, "document"));
  validateXlsxWorkbook(bytes);
  if (bytes.byteLength > OUTPUT_LIMIT) {
    throw new PdfOfficeError("too-large", "The generated workbook exceeds the 30 MB output limit. Convert fewer pages.");
  }
  return {
    bytes,
    detail: `${structure.selectedPages.length} page(s). ${tables ? `${tables} detected table(s) written to separate worksheets` : "No reliable tables were detected, so the text extraction sheet is provided"}; ${rows} table row(s), ${paragraphs} paragraph(s) and ${headings} heading(s) captured.`,
    stats: {
      pages: structure.selectedPages.length,
      textPages: structure.pages.filter((page) => page.text.trim()).length,
      scannedPages: structure.pages.filter((page) => !page.text.trim()).length,
      blankPages: 0,
      ocrPages: 0,
      paragraphs,
      headings,
      tables,
      pictures: 0,
      skippedFullPageImages: 0,
      unplacedImages: 0,
      warnings: [],
    },
  };
}

export async function convertPdfToOffice(
  file: File,
  settings: PdfOfficeSettings,
  options: { signal: AbortSignal; onProgress: (message: string) => void },
): Promise<PdfOfficeResult> {
  if (!file.size) throw new PdfOfficeError("no-content", "The selected file is empty.");
  if (file.size > 25 * 1024 * 1024) throw new PdfOfficeError("too-large", "PDF to Office accepts PDFs up to 25 MB.");
  options.onProgress("Reading the PDF structure…");
  const structure = await extractPdfStructure(file, {
    pages: settings.pages,
    signal: options.signal,
    onProgress: ({ completedPages, totalPages }) => options.onProgress(`Reading page ${completedPages} of ${totalPages}…`),
    includeMetadata: true,
  });
  if (options.signal.aborted) throw new DOMException("Conversion cancelled", "AbortError");

  if (settings.format === "xlsx") {
    if (structure.characterCount === 0) {
      throw new PdfOfficeError("no-content", "No selectable text was found in the selected pages. Scanned PDFs need OCR before Excel export.", structure.emptyPages);
    }
    const converted = await buildWorkbook(structure, settings);
    const base = safeOfficeName(settings.outputName || file.name, file.name);
    return { ...converted, fileName: `${base}.${settings.format}`, mime: OFFICE_MIME[settings.format] };
  }

  if (settings.mode === "visual") {
    const converted = await buildVisualWord(file, structure, options.onProgress, options.signal);
    const base = safeOfficeName(settings.outputName || file.name, file.name);
    return { ...converted, fileName: `${base}.docx`, mime: OFFICE_MIME.docx };
  }

  options.onProgress("Checking page images and text layers…");
  const pictureData = await extractPdfPictureDataFromFile(file, {
    pages: structure.selectedPages,
    signal: options.signal,
    includeFullPage: false,
    onProgress: (completed, total) => options.onProgress(`Inspecting page images ${completed} of ${total}…`),
  });
  const analysisByPage = new Map(pictureData.pages.map((page) => [page.page, page]));
  const kinds = countPageKinds(structure, analysisByPage, []);
  if (!structure.pages.length) throw new PdfOfficeError("no-content", "The selected PDF has no pages.");

  if (structure.characterCount === 0 && kinds.scannedPages.length === 0 && kinds.blankPages.length > 0) {
    throw new PdfOfficeError("no-content", "This PDF has no selectable text or picture content. Scanned PDFs need OCR first; enable OCR here or use the OCR PDF tool.", kinds.blankPages);
  }

  let ocrTextByPage = new Map<number, string>();
  if (kinds.scannedPages.length) {
    if (!settings.ocrScannedPages) {
      throw new PdfOfficeError(
        "scanned-pages",
        `Pages ${pageLabelList(kinds.scannedPages)} have no selectable text. Enable OCR for image-only pages or use Visual Word.`,
        kinds.scannedPages,
      );
    }
    ocrTextByPage = await ocrScannedPages(file, kinds.scannedPages, options.signal, options.onProgress);
  }

  if (structure.characterCount === 0 && ocrTextByPage.size === 0) {
    throw new PdfOfficeError("no-content", "No selectable text was found in the selected pages. Scanned PDFs need OCR first.", structure.emptyPages);
  }

  const converted = await buildEditableWord(structure, settings, pictureData.pictures, analysisByPage, ocrTextByPage, options.onProgress);
  const base = safeOfficeName(settings.outputName || file.name, file.name);
  return { ...converted, fileName: `${base}.docx`, mime: OFFICE_MIME.docx };
}
