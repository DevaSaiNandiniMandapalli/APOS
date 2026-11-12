import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { checkPdfHeader, PDF_LIMITS } from "./pdf-limits";
import { resolvePageSelection } from "./pdf-page-selection";

export type PdfRawTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fontName?: string;
  bold?: boolean;
  italic?: boolean;
  fontFamily?: string;
};

export type PdfLineCell = { text: string; x: number; width: number };

export type PdfLine = {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  fontName: string;
  cells: PdfLineCell[];
};

export type PdfTable = {
  rows: string[][];
  header: boolean;
  columnCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfTextBlock = {
  kind: "heading" | "paragraph" | "list";
  text: string;
  lines: string[];
  level?: 1 | 2 | 3;
  alignment: "left" | "center" | "right";
  y: number;
  bold?: boolean;
  italic?: boolean;
  indent?: number;
};

export type PdfPageBlock = PdfTextBlock | { kind: "table"; table: PdfTable; y: number };

export type PdfPageStructure = {
  page: number;
  width: number;
  height: number;
  lines: PdfLine[];
  blocks: PdfPageBlock[];
  tables: PdfTable[];
  text: string;
  empty: boolean;
};

export type PdfStructureMetadata = {
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  producer?: string;
};

export type PdfStructure = {
  totalPages: number;
  selectedPages: number[];
  pages: PdfPageStructure[];
  metadata: PdfStructureMetadata;
  text: string;
  emptyPages: number[];
  characterCount: number;
};

export type PdfStructureProgress = { completedPages: number; totalPages: number };

const LINE_Y_TOLERANCE = 3;
const MAX_EXTRACTED_CHARACTERS = 20 * 1024 * 1024;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

function textWidth(value: string) {
  return value.replace(/\s+/g, " ").trim().length;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isBoldFont(name: string) {
  return /bold|black|heavy|semibold|demibold/i.test(name);
}

function isItalicFont(name: string) {
  return /italic|oblique/i.test(name);
}

/**
 * Groups positioned PDF text runs into visual lines. The input uses PDF-style
 * coordinates (y grows upwards), so lines are ordered from the top of the page.
 */
export function groupTextLines(items: readonly PdfRawTextItem[]): PdfLine[] {
  const usable = items
    .filter((item) => item && item.str && item.str.trim() && Number.isFinite(item.x) && Number.isFinite(item.y))
    .map((item) => ({ ...item, width: Number.isFinite(item.width) && item.width > 0 ? item.width : item.fontSize * textWidth(item.str) * 0.55 }))
    .sort((left, right) => right.y - left.y || left.x - right.x);

  const rows: PdfRawTextItem[][] = [];
  for (const item of usable) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].y - item.y) <= LINE_Y_TOLERANCE) last.push(item);
    else rows.push([item]);
  }

  return rows.map((row) => {
    const ordered = [...row].sort((left, right) => left.x - right.x);
    let text = "";
    let previousEnd: number | null = null;
    let previousTrailingSpace = false;
    let previousSize = ordered[0]?.fontSize ?? 12;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = 0;
    const sizes: Array<{ size: number; weight: number }> = [];
    const fontWeights = new Map<string, number>();
    let boldWeight = 0;
    let italicWeight = 0;

    for (const item of ordered) {
      const raw = item.str.replace(/\s+/g, " ");
      const value = raw.trim();
      if (!value) {
        previousTrailingSpace = true;
        continue;
      }
      const gap = previousEnd === null ? 0 : item.x - previousEnd;
      const needsSpace = Boolean(text) && (previousTrailingSpace || /^\s/.test(raw) || gap > Math.max(1.1, Math.min(item.fontSize, previousSize) * 0.16));
      if (needsSpace && !text.endsWith(" ")) text += " ";
      text += value;
      previousEnd = item.x + item.width;
      previousTrailingSpace = /\s$/.test(raw);
      previousSize = item.fontSize;
      minX = Math.min(minX, item.x);
      maxX = Math.max(maxX, item.x + item.width);
      sizes.push({ size: item.fontSize, weight: Math.max(1, value.length) });
      const fontName = item.fontName ?? "";
      fontWeights.set(fontName, (fontWeights.get(fontName) ?? 0) + value.length);
      if (item.bold || isBoldFont(fontName)) boldWeight += value.length;
      if (item.italic || isItalicFont(fontName)) italicWeight += value.length;
    }

    const totalLetters = [...fontWeights.values()].reduce((total, value) => total + value, 0) || 1;
    const totalSizeWeight = sizes.reduce((total, entry) => total + entry.weight, 0) || 1;
    const fontSize = sizes.reduce((total, entry) => total + entry.size * entry.weight, 0) / totalSizeWeight;
    const fontName = [...fontWeights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";

    const cells: PdfLineCell[] = [];
    let cellText = "";
    let cellStart = ordered[0]?.x ?? 0;
    let cellEnd = cellStart;
    let cellPreviousEnd: number | null = null;
    for (const item of ordered) {
      const value = item.str.replace(/\s+/g, " ").trim();
      if (!value) continue;
      const gap = cellPreviousEnd === null ? 0 : item.x - cellPreviousEnd;
      const threshold = Math.max(8, item.fontSize * 1.25);
      if (cellText && (item.str.startsWith(" ") || gap > threshold)) {
        cells.push({ text: cellText.trim(), x: cellStart, width: Math.max(1, cellEnd - cellStart) });
        cellText = value;
        cellStart = item.x;
        cellEnd = item.x + item.width;
      } else {
        cellText = cellText ? `${cellText} ${value}` : value;
        cellEnd = Math.max(cellEnd, item.x + item.width);
      }
      cellPreviousEnd = item.x + item.width;
    }
    if (cellText.trim()) cells.push({ text: cellText.trim(), x: cellStart, width: Math.max(1, cellEnd - cellStart) });

    return {
      text: text.replace(/\s+/g, " ").trim(),
      x: Number.isFinite(minX) ? minX : 0,
      y: ordered[0].y,
      width: Math.max(1, maxX - (Number.isFinite(minX) ? minX : 0)),
      fontSize: fontSize || 12,
      bold: boldWeight / totalLetters >= 0.5,
      italic: italicWeight / totalLetters >= 0.5,
      fontName,
      cells,
    };
  }).filter((line) => line.text.length > 0);
}

function clusterColumns(lines: readonly PdfLine[]) {
  const cells = lines.flatMap((line) => line.cells);
  const tolerance = Math.max(9, median(lines.map((line) => line.fontSize)) * 1.15);
  const columns: Array<{ center: number; left: number; right: number; count: number }> = [];
  for (const cell of [...cells].sort((left, right) => left.x - right.x)) {
    const current = columns[columns.length - 1];
    if (current && Math.abs(current.center - cell.x) <= tolerance) {
      current.count += 1;
      current.left = Math.min(current.left, cell.x);
      current.right = Math.max(current.right, cell.x + cell.width);
      current.center = (current.center * (current.count - 1) + cell.x) / current.count;
    } else {
      columns.push({ center: cell.x, left: cell.x, right: cell.x + cell.width, count: 1 });
    }
  }
  return { columns, tolerance };
}

function buildTable(lines: PdfLine[], pageWidth: number, pageHeight: number): PdfTable | null {
  if (lines.length < 2) return null;
  const { columns, tolerance } = clusterColumns(lines);
  if (columns.length < 2 || columns.length > 24) return null;

  const rows: string[][] = [];
  let populatedRows = 0;
  for (const line of lines) {
    const row = Array.from({ length: columns.length }, () => "");
    let populated = 0;
    for (const cell of line.cells) {
      let best = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      columns.forEach((column, index) => {
        const distance = Math.abs(column.center - cell.x);
        if (distance < bestDistance) { best = index; bestDistance = distance; }
      });
      if (best >= 0 && bestDistance <= Math.max(tolerance * 2.2, cell.width + tolerance)) {
        row[best] = row[best] ? `${row[best]} ${cell.text}` : cell.text;
        populated += 1;
      }
    }
    rows.push(row.map((value) => value.replace(/\s+/g, " ").trim()));
    if (populated >= 2) populatedRows += 1;
  }

  const nonEmpty = rows.flat().filter(Boolean);
  if (populatedRows < 2 || nonEmpty.length < 4) return null;
  if (columns.length === 2 && lines.length < 3 && !lines[0].bold && nonEmpty.some((cell) => cell.length > 45)) return null;

  const first = lines[0];
  const last = lines[lines.length - 1];
  const left = Math.min(...lines.map((line) => line.x));
  const right = Math.max(...lines.map((line) => line.x + line.width));
  const width = Math.max(1, right - left);
  const height = Math.max(1, first.y + first.fontSize - last.y + last.fontSize);
  if (width < pageWidth * 0.12 || height > pageHeight * 0.98) return null;

  return {
    rows,
    header: first.bold || rows[0].every((value) => value.length > 0) && rows[0].every((value) => value === value.toUpperCase()),
    columnCount: columns.length,
    x: left,
    y: first.y,
    width,
    height,
  };
}

/** Finds runs of aligned multi-column rows and treats them as tables. */
export function detectTables(lines: readonly PdfLine[], pageWidth: number, pageHeight: number): { tables: PdfTable[]; tableLineIndexes: Set<number> } {
  const tables: PdfTable[] = [];
  const tableLineIndexes = new Set<number>();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const candidate = line.cells.filter((cell) => cell.text).length >= 2;
    if (!candidate) { index += 1; continue; }
    let end = index;
    while (end + 1 < lines.length) {
      const next = lines[end + 1];
      if (next.cells.filter((cell) => cell.text).length < 2) break;
      const verticalGap = lines[end].y - next.y;
      if (verticalGap > Math.max(lines[end].fontSize, next.fontSize) * 2.9) break;
      end += 1;
    }
    if (end > index) {
      const run = lines.slice(index, end + 1);
      const table = buildTable(run, pageWidth, pageHeight);
      if (table) {
        tables.push(table);
        for (let position = index; position <= end; position += 1) tableLineIndexes.add(position);
      }
    }
    index = end + 1;
  }
  return { tables, tableLineIndexes };
}

function headingFor(line: PdfLine, bodySize: number): 1 | 2 | 3 | null {
  const ratio = line.fontSize / Math.max(1, bodySize);
  const short = line.text.length <= 140;
  const upper = line.text.length > 2 && line.text === line.text.toUpperCase() && /[A-Z]/.test(line.text);
  if (!short) return null;
  if (ratio >= 1.62) return 1;
  if (ratio >= 1.28) return 2;
  if (ratio >= 1.16 || (line.bold && (upper || line.text.length <= 80))) return 3;
  return null;
}

function isListLine(text: string) {
  return /^(?:[•▪◦‣·●○]|[-*]|\d{1,3}[.)]|[a-zA-Z][.)])\s+/.test(text);
}

function alignmentFor(line: PdfLine, pageWidth: number): "left" | "center" | "right" {
  const center = line.x + line.width / 2;
  if (Math.abs(center - pageWidth / 2) <= pageWidth * 0.035 && line.x > pageWidth * 0.12) return "center";
  if (line.x + line.width > pageWidth * 0.82 && line.x > pageWidth * 0.35 && Math.abs(center - pageWidth / 2) < pageWidth * 0.18) return "right";
  return "left";
}

export function buildTextBlocks(lines: readonly PdfLine[], pageWidth: number): { blocks: PdfTextBlock[]; bodySize: number } {
  const weighted: number[] = [];
  for (const line of lines) {
    for (let index = 0; index < Math.max(1, Math.min(80, textWidth(line.text))); index += 1) weighted.push(line.fontSize);
  }
  const bodySize = median(weighted) || median(lines.map((line) => line.fontSize)) || 12;
  const blocks: PdfTextBlock[] = [];
  let current: PdfTextBlock | null = null;
  let lastLineY = 0;
  let lastLineSize = bodySize;

  const flush = () => {
    if (current && current.text.trim()) blocks.push(current);
    current = null;
  };

  for (const line of lines) {
    const level = headingFor(line, bodySize);
    if (level) {
      flush();
      blocks.push({
        kind: "heading",
        text: line.text,
        lines: [line.text],
        level,
        alignment: alignmentFor(line, pageWidth),
        y: line.y,
        bold: line.bold,
        italic: line.italic,
        indent: Math.max(0, line.x),
      });
      continue;
    }

    const startsList = isListLine(line.text);
    const gap = current ? lastLineY - line.y : 0;
    const breakParagraph = !current
      || (startsList && current.kind !== "list")
      || (startsList && current.kind === "list")
      || gap > Math.max(line.fontSize, lastLineSize) * 1.85;

    if (breakParagraph) {
      flush();
      current = {
        kind: startsList ? "list" : "paragraph",
        text: line.text,
        lines: [line.text],
        alignment: alignmentFor(line, pageWidth),
        y: line.y,
        bold: line.bold,
        italic: line.italic,
        indent: Math.max(0, line.x),
      };
      lastLineY = line.y;
      lastLineSize = line.fontSize;
      continue;
    }

    if (current!.text.endsWith("-") && /^[a-z]/.test(line.text)) current!.text = `${current!.text.slice(0, -1)}${line.text}`;
    else current!.text = `${current!.text} ${line.text}`;
    current!.lines.push(line.text);
    lastLineY = line.y;
    lastLineSize = line.fontSize;
  }
  flush();
  return { blocks, bodySize };
}

export function buildPdfPageStructure(
  items: readonly PdfRawTextItem[],
  pageWidth: number,
  pageHeight: number,
  pageNumber = 1,
): PdfPageStructure {
  const lines = groupTextLines(items);
  const { tables, tableLineIndexes } = detectTables(lines, pageWidth, pageHeight);
  const proseLines = lines.filter((_line, index) => !tableLineIndexes.has(index));
  const { blocks: textBlocks } = buildTextBlocks(proseLines, pageWidth);
  const blocks: PdfPageBlock[] = [
    ...textBlocks,
    ...tables.map((table) => ({ kind: "table" as const, table, y: table.y })),
  ].sort((left, right) => right.y - left.y);

  const parts: string[] = [];
  for (const block of blocks) {
    if (block.kind === "table") {
      parts.push(block.table.rows.map((row) => row.join("\t")).join("\n"));
    } else {
      parts.push(block.text);
    }
  }
  const text = parts.join("\n\n").trim();
  return {
    page: pageNumber,
    width: pageWidth,
    height: pageHeight,
    lines,
    blocks,
    tables,
    text,
    empty: text.length === 0,
  };
}

type PdfJsModule = typeof import("pdfjs-dist");

async function getPdfJs(): Promise<PdfJsModule> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  return pdfjs;
}

export type PdfFontStyle = { bold: boolean; italic: boolean; family: string };

export function resolvePdfFontStyles(
  page: { commonObjs?: { get: (name: string) => unknown } },
  fontNames: Iterable<string>,
): Map<string, PdfFontStyle> {
  const styles = new Map<string, PdfFontStyle>();
  for (const fontName of fontNames) {
    if (!fontName || styles.has(fontName)) continue;
    try {
      const font = page.commonObjs?.get(fontName) as
        | { bold?: boolean; italic?: boolean; black?: boolean; loadedName?: string; fallbackName?: string; cssFontInfo?: { fontFamily?: string; fontWeight?: string | number } }
        | undefined;
      if (!font) continue;
      const weight = String(font.cssFontInfo?.fontWeight ?? "");
      styles.set(fontName, {
        bold: Boolean(font.bold || font.black || /^(?:[6-9]00|bold|bolder)$/i.test(weight)),
        italic: Boolean(font.italic),
        family: font.cssFontInfo?.fontFamily || font.loadedName || font.fallbackName || "",
      });
    } catch {
      // Font metadata is optional. The name-based fallback still runs.
    }
  }
  return styles;
}

export function normalisePageTextItems(
  pdfjs: PdfJsModule,
  items: readonly unknown[],
  viewport: { transform: number[]; height: number },
  fontStyles?: ReadonlyMap<string, PdfFontStyle>,
): PdfRawTextItem[] {
  const output: PdfRawTextItem[] = [];
  for (const candidate of items) {
    const item = candidate as {
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
      fontName?: string;
    };
    if (typeof item.str !== "string" || !item.str.trim() || !Array.isArray(item.transform)) continue;
    const transformed = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontSize = Math.max(4, Math.hypot(transformed[2], transformed[3]) || Math.hypot(transformed[0], transformed[1]) || (item.height ?? 12));
    const width = Math.max(1, item.width ?? fontSize * textWidth(item.str) * 0.55);
    const x = transformed[4];
    const y = viewport.height - transformed[5];
    const style = item.fontName ? fontStyles?.get(item.fontName) : undefined;
    output.push({
      str: item.str,
      x,
      y,
      width,
      fontSize,
      fontName: item.fontName,
      bold: style?.bold,
      italic: style?.italic,
      fontFamily: style?.family,
    });
  }
  return output;
}

export async function extractPdfStructure(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
  options: {
    pages?: string;
    signal: AbortSignal;
    onProgress: (progress: PdfStructureProgress) => void;
    includeMetadata?: boolean;
  },
): Promise<PdfStructure> {
  if (!file.size) throw new Error("The selected file is empty.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("This PDF is larger than the 25 MB conversion limit.");
  let input: Uint8Array | null = null;
  let loadingTask: PDFDocumentLoadingTask | null = null;
  let document: PDFDocumentProxy | null = null;
  let abortHandler: (() => void) | null = null;
  try {
    const buffer = await file.arrayBuffer();
    if (options.signal.aborted) { new Uint8Array(buffer).fill(0); throw new DOMException("Conversion cancelled", "AbortError"); }
    input = new Uint8Array(buffer);
    if (!checkPdfHeader(input.subarray(0, 1024))) throw new Error("The selected file does not have a PDF signature.");
    const pdfjs = await getPdfJs();
    loadingTask = pdfjs.getDocument({ data: input });
    abortHandler = () => { if (loadingTask) void loadingTask.destroy(); };
    options.signal.addEventListener("abort", abortHandler, { once: true });
    try { document = await loadingTask.promise; }
    catch {
      if (options.signal.aborted) throw new DOMException("Conversion cancelled", "AbortError");
      throw new Error("The PDF could not be opened. It may be corrupt, encrypted, or unsupported.");
    }
    if (document.numPages < 1 || document.numPages > PDF_LIMITS.pages) throw new Error(`PDF files must contain 1-${PDF_LIMITS.pages} pages.`);
    const selectedPages = resolvePageSelection(options.pages, document.numPages);
    let metadata: PdfStructureMetadata = {};
    if (options.includeMetadata !== false) {
      try {
        const info = await document.getMetadata();
        const values = (info.info ?? {}) as Record<string, unknown>;
        metadata = {
          title: typeof values.Title === "string" ? values.Title : undefined,
          author: typeof values.Author === "string" ? values.Author : undefined,
          subject: typeof values.Subject === "string" ? values.Subject : undefined,
          creator: typeof values.Creator === "string" ? values.Creator : undefined,
          producer: typeof values.Producer === "string" ? values.Producer : undefined,
        };
      } catch { /* Metadata is optional. */ }
    }

    const pages: PdfPageStructure[] = [];
    const emptyPages: number[] = [];
    let characterCount = 0;
    options.onProgress({ completedPages: 0, totalPages: selectedPages.length });
    for (let position = 0; position < selectedPages.length; position += 1) {
      if (options.signal.aborted) throw new DOMException("Conversion cancelled", "AbortError");
      const pageNumber = selectedPages[position];
      try {
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        let fontStyles: Map<string, PdfFontStyle> | undefined;
        try {
          await page.getOperatorList();
          fontStyles = resolvePdfFontStyles(page, Object.keys(content.styles));
        } catch {
          // Some damaged pages cannot provide an operator list; text still works.
        }
        const raw = normalisePageTextItems(pdfjs, content.items as unknown[], viewport, fontStyles);
        const structure = buildPdfPageStructure(raw, viewport.width, viewport.height, pageNumber);
        pages.push(structure);
        if (structure.empty) emptyPages.push(pageNumber);
        characterCount += structure.text.length;
        if (characterCount > MAX_EXTRACTED_CHARACTERS) throw new Error("Extracted text exceeds the 20 MB output limit. Convert fewer pages.");
        page.cleanup();
        options.onProgress({ completedPages: position + 1, totalPages: selectedPages.length });
      } catch (error) {
        if (options.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw new DOMException("Conversion cancelled", "AbortError");
        if (error instanceof Error && error.message.includes("20 MB output limit")) throw error;
        throw new Error(`Page ${pageNumber} could not be read. The PDF may contain damaged or unsupported page content.`);
      }
    }

    const text = pages.map((page) => `--- Page ${page.page} ---\n${page.text}`).join("\n\n");
    return { totalPages: document.numPages, selectedPages, pages, metadata, text, emptyPages, characterCount };
  } finally {
    if (abortHandler) options.signal.removeEventListener("abort", abortHandler);
    if (input?.byteLength) input.fill(0);
    if (loadingTask) { try { await loadingTask.destroy(); } catch { /* already destroyed */ } }
  }
}
