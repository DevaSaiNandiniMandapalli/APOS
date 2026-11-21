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
  color?: string;
};

export type PdfLineCell = {
  text: string;
  x: number;
  width: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  fontFamily?: string;
};

export type PdfLine = {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  fontName: string;
  fontFamily?: string;
  color?: string;
  cells: PdfLineCell[];
};

export type PdfTableCell = {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  fontFamily?: string;
};

export type PdfTable = {
  rows: string[][];
  header: boolean;
  columnCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  bordered?: boolean;
  richRows?: PdfTableCell[][];
  columnWidths?: number[];
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
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  spans?: PdfTextSpan[];
  ruleBelow?: boolean;
};

export type PdfTextSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
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
    const familyWeights = new Map<string, number>();
    const colorWeights = new Map<string, number>();
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
      if (item.fontFamily) familyWeights.set(item.fontFamily, (familyWeights.get(item.fontFamily) ?? 0) + value.length);
      if (item.color) colorWeights.set(item.color, (colorWeights.get(item.color) ?? 0) + value.length);
      if (item.bold || isBoldFont(fontName)) boldWeight += value.length;
      if (item.italic || isItalicFont(fontName)) italicWeight += value.length;
    }

    const totalLetters = [...fontWeights.values()].reduce((total, value) => total + value, 0) || 1;
    const totalSizeWeight = sizes.reduce((total, entry) => total + entry.weight, 0) || 1;
    const fontSize = sizes.reduce((total, entry) => total + entry.size * entry.weight, 0) / totalSizeWeight;
    const fontName = [...fontWeights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";
    const fontFamily = [...familyWeights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";
    const color = [...colorWeights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];

    const cells: PdfLineCell[] = [];
    let cellText = "";
    let cellStart = ordered[0]?.x ?? 0;
    let cellEnd = cellStart;
    let cellPreviousEnd: number | null = null;
    let cellChars = 0;
    let cellBold = 0;
    let cellItalic = 0;
    let cellSizes: Array<{ size: number; weight: number }> = [];
    let cellFamilies = new Map<string, number>();
    let cellColors = new Map<string, number>();

    const addCellStyle = (item: PdfRawTextItem, value: string) => {
      const weight = Math.max(1, value.length);
      cellChars += weight;
      cellSizes.push({ size: item.fontSize, weight });
      if (item.fontFamily) cellFamilies.set(item.fontFamily, (cellFamilies.get(item.fontFamily) ?? 0) + weight);
      if (item.color) cellColors.set(item.color, (cellColors.get(item.color) ?? 0) + weight);
      if (item.bold || isBoldFont(item.fontName ?? "")) cellBold += weight;
      if (item.italic || isItalicFont(item.fontName ?? "")) cellItalic += weight;
    };

    const pushCell = () => {
      const value = cellText.trim();
      if (!value) return;
      const weight = cellSizes.reduce((total, entry) => total + entry.weight, 0) || 1;
      cells.push({
        text: value,
        x: cellStart,
        width: Math.max(1, cellEnd - cellStart),
        color: [...cellColors.entries()].sort((left, right) => right[1] - left[1])[0]?.[0],
        bold: cellBold / Math.max(1, cellChars) >= 0.5,
        italic: cellItalic / Math.max(1, cellChars) >= 0.5,
        fontSize: cellSizes.reduce((total, entry) => total + entry.size * entry.weight, 0) / weight,
        fontFamily: [...cellFamilies.entries()].sort((left, right) => right[1] - left[1])[0]?.[0],
      });
    };

    for (const item of ordered) {
      const value = item.str.replace(/\s+/g, " ").trim();
      if (!value) continue;
      const gap = cellPreviousEnd === null ? 0 : item.x - cellPreviousEnd;
      const threshold = Math.max(8, item.fontSize * 1.25);
      if (cellText && (item.str.startsWith(" ") || gap > threshold)) {
        pushCell();
        cellText = value;
        cellStart = item.x;
        cellEnd = item.x + item.width;
        cellChars = 0;
        cellBold = 0;
        cellItalic = 0;
        cellSizes = [];
        cellFamilies = new Map();
        cellColors = new Map();
        addCellStyle(item, value);
      } else {
        cellText = cellText ? `${cellText} ${value}` : value;
        cellEnd = Math.max(cellEnd, item.x + item.width);
        addCellStyle(item, value);
      }
      cellPreviousEnd = item.x + item.width;
    }
    pushCell();

    return {
      text: text.replace(/\s+/g, " ").trim(),
      x: Number.isFinite(minX) ? minX : 0,
      y: ordered[0].y,
      width: Math.max(1, maxX - (Number.isFinite(minX) ? minX : 0)),
      fontSize: fontSize || 12,
      bold: boldWeight / totalLetters >= 0.5,
      italic: italicWeight / totalLetters >= 0.5,
      fontName,
      fontFamily,
      color,
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
  const richRows: PdfTableCell[][] = [];
  let populatedRows = 0;
  for (const line of lines) {
    const row = Array.from({ length: columns.length }, () => "");
    const richRow: PdfTableCell[] = Array.from({ length: columns.length }, () => ({ text: "" }));
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
        const existing = richRow[best];
        richRow[best] = {
          text: existing.text ? `${existing.text} ${cell.text}` : cell.text,
          color: existing.color ?? cell.color,
          bold: existing.bold || cell.bold,
          italic: existing.italic || cell.italic,
          fontSize: existing.fontSize ?? cell.fontSize,
          fontFamily: existing.fontFamily ?? cell.fontFamily,
        };
        populated += 1;
      }
    }
    rows.push(row.map((value) => value.replace(/\s+/g, " ").trim()));
    richRows.push(richRow.map((cell) => ({ ...cell, text: cell.text.replace(/\s+/g, " ").trim() })));
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

  const orderedColumns = [...columns].sort((leftColumn, rightColumn) => leftColumn.center - rightColumn.center);
  const edges = [left];
  for (let index = 1; index < orderedColumns.length; index += 1) {
    edges.push(Math.max(edges[index - 1] + 1, Math.min(orderedColumns[index].left, right - 1)));
  }
  edges.push(right);
  const columnWidths = edges.slice(1).map((edge, index) => Math.max(1, edge - edges[index]));

  return {
    rows,
    header: first.bold || rows[0].every((value) => value.length > 0) && rows[0].every((value) => value === value.toUpperCase()),
    columnCount: columns.length,
    x: left,
    y: first.y,
    width,
    height,
    richRows,
    columnWidths,
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
  const text = line.text.trim();
  const short = text.length <= 140;
  const upper = text.length > 2 && text === text.toUpperCase() && /[A-Z]/.test(text);
  if (!short) return null;
  if (ratio >= 1.62) return 1;
  if (ratio >= 1.28) return 2;
  if (ratio >= 1.16) return 3;
  // Section headings are often only slightly larger than body text (11pt vs
  // 10pt in a typical resume) and bold detection is unreliable because it
  // depends on optional PDF font metadata. A short ALL-CAPS line is a heading.
  if (upper && ratio >= 1.02 && text.length <= 60) return 3;
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

export function buildTextBlocks(lines: readonly PdfLine[], pageWidth: number, rules: readonly number[] = []): { blocks: PdfTextBlock[]; bodySize: number } {
  const weighted: number[] = [];
  for (const line of lines) {
    for (let index = 0; index < Math.max(1, Math.min(80, textWidth(line.text))); index += 1) weighted.push(line.fontSize);
  }
  const bodySize = median(weighted) || median(lines.map((line) => line.fontSize)) || 12;
  // The right edge of the text column, used to tell a wrapped line from the
  // last line of a paragraph.
  const contentRight = lines.reduce((widest, line) => Math.max(widest, line.x + line.width), 0);
  const blocks: PdfTextBlock[] = [];
  let current: PdfTextBlock | null = null;
  let lastLineY = 0;
  let lastLineSize = bodySize;
  let lastLine: PdfLine | null = null;

  const flush = () => {
    if (current && current.text.trim()) blocks.push(current);
    current = null;
  };

  const spanForLine = (line: PdfLine, text = line.text): PdfTextSpan => ({
    text,
    bold: line.bold,
    italic: line.italic,
    fontSize: line.fontSize,
    fontFamily: line.fontFamily,
    color: line.color,
  });

  for (const line of lines) {
    const level = headingFor(line, bodySize);
    if (level) {
      flush();
      // A horizontal rule drawn just under the heading is part of the design.
      // PDF y grows upward, so "below" means a smaller y.
      const ruleBelow = rules.some((ruleY) => ruleY < line.y && line.y - ruleY < Math.max(24, line.fontSize * 2.5));
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
        fontSize: line.fontSize,
        fontFamily: line.fontFamily,
        color: line.color,
        spans: [spanForLine(line)],
        ruleBelow,
      });
      lastLine = line;
      lastLineY = line.y;
      lastLineSize = line.fontSize;
      continue;
    }

    const startsList = isListLine(line.text);
    const gap = current ? lastLineY - line.y : 0;
    const gapLimit = Math.max(line.fontSize, lastLineSize);
    // A line that starts further left than the block it would join is a new
    // entry (a job title after an indented bullet, for example).
    const outdented = current ? line.x < (current.indent ?? 0) - 2 : false;
    // A wrapped line fills the column; the last line of a paragraph stops
    // short. This is the most reliable paragraph signal when the PDF carries
    // no bold or spacing metadata.
    const previousEndedShort = lastLine
      ? lastLine.x + lastLine.width < contentRight - Math.max(6, lastLine.fontSize * 4)
      : false;
    // A line closing with a bracket or colon is a label or entry, not prose.
    const previousClosed = lastLine ? /[)\]:;]\s*$/.test(lastLine.text) && /^[A-Z0-9]/.test(line.text.trim()) : false;
    const breakParagraph = !current
      // Every bullet starts its own block.
      || startsList
      // A bullet list ends when a bold line or an outdented line follows.
      || (current.kind === "list" && (Boolean(line.bold) || outdented))
      // A bold line is a title, label or entry, never a continuation.
      || (Boolean(line.bold) && !current.bold)
      // Two consecutive bold lines are separate entries when the gap grows.
      || (Boolean(line.bold) && Boolean(current.bold) && gap > gapLimit * 1.2)
      // The previous line stopped short of the column, so it ended a block.
      || previousEndedShort
      // The previous line closed a label or entry.
      || previousClosed
      // A visibly larger gap separates paragraphs.
      || gap > gapLimit * 1.5;

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
        fontSize: line.fontSize,
        fontFamily: line.fontFamily,
        color: line.color,
        spans: [spanForLine(line)],
      };
      lastLine = line;
      lastLineY = line.y;
      lastLineSize = line.fontSize;
      continue;
    }

    if (current!.text.endsWith("-") && /^[a-z]/.test(line.text)) {
      current!.text = `${current!.text.slice(0, -1)}${line.text}`;
      const spans = current!.spans ?? [];
      const previousSpan = spans[spans.length - 1];
      if (previousSpan) previousSpan.text = `${previousSpan.text.replace(/-$/, "")}${line.text}`;
    } else {
      current!.text = `${current!.text} ${line.text}`;
      current!.spans = [...(current!.spans ?? []), spanForLine(line)];
    }
    current!.lines.push(line.text);
    lastLine = line;
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
  rules: readonly number[] = [],
  verticalRules: readonly { x: number; y0: number; y1: number }[] = [],
): PdfPageStructure {
  const lines = groupTextLines(items);
  const { tables, tableLineIndexes } = detectTables(lines, pageWidth, pageHeight);
  const proseLines = lines.filter((_line, index) => !tableLineIndexes.has(index));
  const { blocks: textBlocks } = buildTextBlocks(proseLines, pageWidth, rules);
  const blocks: PdfPageBlock[] = [
    ...textBlocks,
    ...tables.map((table) => ({
      kind: "table" as const,
      table: { ...table, bordered: tableHasBorders(table, verticalRules) },
      y: table.y,
    })),
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

/**
 * pdf.js OPS codes for paths that are stroked: stroke, closeStroke, fillStroke,
 * eoFillStroke, closeFillStroke, closeEOFillStroke. Filled-only paths are
 * excluded because a white page background is a filled rectangle whose edges
 * would otherwise look like table borders.
 */
const STROKED_PATH_OPS = new Set([20, 21, 24, 25, 26, 27]);

/**
 * Finds horizontal rules drawn on the page (the lines under section headings in
 * most resumes and reports). Returns their y positions in display space, the
 * same coordinate system as `PdfLine.y`.
 */
export function detectHorizontalRules(
  pdfjs: PdfJsModule,
  operatorList: { fnArray: readonly number[]; argsArray: readonly unknown[] },
  viewport: { transform: number[]; width: number; height: number },
): number[] {
  const rules: number[] = [];
  const { fnArray, argsArray } = operatorList;
  if (!Array.isArray(fnArray) || !Array.isArray(argsArray)) return rules;
  const minimumWidth = viewport.width * 0.4;
  const [, b, , d, , f] = viewport.transform;
  const toDisplayY = (x: number, y: number) => viewport.height - (b * x + d * y + f);
  // pdf.js stores a path as [OPS op, [DrawOPS buffer], minMax]. The buffer is a
  // flat run of [command, ...coordinates] using DrawOPS codes:
  // 0 moveTo, 1 lineTo, 2 curveTo, 3 quadraticCurveTo, 4 closePath.
  const MOVE_TO = 0;
  const LINE_TO = 1;
  const CURVE_TO = 2;
  const QUADRATIC_TO = 3;
  const CLOSE_PATH = 4;

  for (let index = 0; index < fnArray.length; index += 1) {
    if (fnArray[index] !== pdfjs.OPS.constructPath) continue;
    const args = argsArray[index];
    if (!Array.isArray(args)) continue;
    // Only painted paths count. Clipping paths (endPath/clip) are invisible.
    if (typeof args[0] === "number" && !STROKED_PATH_OPS.has(args[0])) continue;
    const wrapper = args[1];
    const data = Array.isArray(wrapper) ? wrapper[0] : wrapper;
    if (!data || typeof (data as ArrayLike<number>).length !== "number") continue;
    const path = data as ArrayLike<number>;

    let cursor = 0;
    let previous: { x: number; y: number } | null = null;
    while (cursor < path.length) {
      const command = path[cursor];
      cursor += 1;
      if (command === MOVE_TO) {
        previous = { x: Number(path[cursor]), y: Number(path[cursor + 1]) };
        cursor += 2;
      } else if (command === LINE_TO) {
        const point = { x: Number(path[cursor]), y: Number(path[cursor + 1]) };
        cursor += 2;
        if (previous && Math.abs(point.y - previous.y) < 0.75 && Math.abs(point.x - previous.x) >= minimumWidth) {
          rules.push(toDisplayY(previous.x, previous.y));
        }
        previous = point;
      } else if (command === CURVE_TO) {
        cursor += 6;
        previous = null;
      } else if (command === QUADRATIC_TO) {
        cursor += 4;
        previous = null;
      } else if (command === CLOSE_PATH) {
        previous = null;
      } else {
        break;
      }
    }
  }
  // Page borders and background rectangles are not section rules.
  const margin = viewport.height * 0.03;
  const filtered = rules.filter((y) => y > margin && y < viewport.height - margin);
  return [...new Set(filtered.map((y) => Math.round(y * 10) / 10))];
}

/**
 * Collects vertical rules drawn on the page, in PDF user space. A bordered
 * table (an exam timetable, an invoice) separates its columns with these.
 * Clipping paths, filled-only paths and white strokes are ignored.
 */
export function detectVerticalRules(
  pdfjs: PdfJsModule,
  operatorList: { fnArray: readonly number[]; argsArray: readonly unknown[] },
): { x: number; y0: number; y1: number }[] {
  const { fnArray, argsArray } = operatorList;
  if (!Array.isArray(fnArray) || !Array.isArray(argsArray)) return [];
  const MOVE_TO = 0;
  const LINE_TO = 1;
  const CURVE_TO = 2;
  const QUADRATIC_TO = 3;
  const CLOSE_PATH = 4;
  const found: { x: number; y0: number; y1: number }[] = [];
  const colourStack: boolean[] = [];
  let strokeIsWhite = false;

  for (let index = 0; index < fnArray.length; index += 1) {
    const op = fnArray[index];
    const args = argsArray[index];
    if (op === 10) {
      colourStack.push(strokeIsWhite);
      continue;
    }
    if (op === 11) {
      strokeIsWhite = colourStack.pop() ?? false;
      continue;
    }
    if (op === 56) {
      strokeIsWhite = Number((args as unknown[])[0]) >= 0.95;
      continue;
    }
    if (op === 58) {
      strokeIsWhite = /^#f{6}$/i.test(String((args as unknown[])[0]));
      continue;
    }
    if (op === 52) {
      const components = (args as unknown[])[0];
      strokeIsWhite = Array.isArray(components) && components.length > 0 && components.every((value) => Number(value) >= 0.95);
      continue;
    }
    if (op !== pdfjs.OPS.constructPath) continue;
    if (!Array.isArray(args)) continue;
    if (typeof args[0] === "number" && !STROKED_PATH_OPS.has(args[0])) continue;
    if (strokeIsWhite) continue;
    const wrapper = args[1];
    const data = Array.isArray(wrapper) ? wrapper[0] : wrapper;
    if (!data || typeof (data as ArrayLike<number>).length !== "number") continue;
    const path = data as ArrayLike<number>;

    let cursor = 0;
    let previous: { x: number; y: number } | null = null;
    while (cursor < path.length) {
      const command = path[cursor];
      cursor += 1;
      if (command === MOVE_TO) {
        previous = { x: Number(path[cursor]), y: Number(path[cursor + 1]) };
        cursor += 2;
      } else if (command === LINE_TO) {
        const point = { x: Number(path[cursor]), y: Number(path[cursor + 1]) };
        cursor += 2;
        if (previous && Math.abs(point.x - previous.x) < 0.75 && Math.abs(point.y - previous.y) > 20) {
          found.push({ x: previous.x, y0: Math.min(previous.y, point.y), y1: Math.max(previous.y, point.y) });
        }
        previous = point;
      } else if (command === CURVE_TO) {
        cursor += 6;
        previous = null;
      } else if (command === QUADRATIC_TO) {
        cursor += 4;
        previous = null;
      } else if (command === CLOSE_PATH) {
        previous = null;
      } else {
        break;
      }
    }
  }
  return found;
}

/** A table is bordered when at least two vertical rules cross its own rows. */
export function tableHasBorders(
  table: { x: number; y: number; width: number; height: number },
  verticalRules: readonly { x: number; y0: number; y1: number }[],
): boolean {
  const top = table.y;
  const bottom = table.y - table.height;
  const columns = new Set<number>();
  for (const rule of verticalRules) {
    const overlap = Math.min(rule.y1, top) - Math.max(rule.y0, bottom);
    // A real column separator spans the table's rows, not just part of them.
    if (overlap < table.height * 0.8) continue;
    if (rule.x < table.x - 2 || rule.x > table.x + table.width + 2) continue;
    columns.add(Math.round(rule.x));
    if (columns.size >= 2) return true;
  }
  return false;
}

export function resolvePdfFontStyles(
  page: { commonObjs?: { get: (name: string) => unknown } },
  fontNames: Iterable<string>,
): Map<string, PdfFontStyle> {
  const styles = new Map<string, PdfFontStyle>();
  for (const fontName of fontNames) {
    if (!fontName || styles.has(fontName)) continue;
    try {
      const font = page.commonObjs?.get(fontName) as
        | {
            bold?: boolean;
            italic?: boolean;
            black?: boolean;
            name?: string;
            loadedName?: string;
            fallbackName?: string;
            cssFontInfo?: { fontFamily?: string; fontWeight?: string | number };
          }
        | undefined;
      if (!font) continue;
      const weight = String(font.cssFontInfo?.fontWeight ?? "");
      // pdf.js only sets `bold` when the font descriptor says so, which many
      // real-world PDFs omit. The PostScript name almost always carries it.
      const names = `${font.name ?? ""} ${font.fallbackName ?? ""} ${font.loadedName ?? ""}`;
      const nameBold = /(?:^|[^a-z])(?:bold|black|heavy|semibold|demibold)(?:[^a-z]|$)/i.test(names);
      const nameItalic = /(?:^|[^a-z])(?:italic|oblique)(?:[^a-z]|$)/i.test(names);
      styles.set(fontName, {
        bold: Boolean(font.bold || font.black || nameBold || /^(?:[6-9]00|bold|bolder)$/i.test(weight)),
        italic: Boolean(font.italic || nameItalic),
        family: font.cssFontInfo?.fontFamily || font.name || font.loadedName || font.fallbackName || "",
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
  itemColors?: readonly (string | undefined)[],
): PdfRawTextItem[] {
  const output: PdfRawTextItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const candidate = items[index];
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
      color: itemColors?.[index],
    });
  }
  return output;
}

function hexColor(red: number, green: number, blue: number): string {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, "0");
  return `${channel(red)}${channel(green)}${channel(blue)}`.toUpperCase();
}

function fillColorFromOperator(pdfjs: PdfJsModule, op: number, args: readonly unknown[]): string | undefined {
  const values = Array.isArray(args[0]) ? args[0] as number[] : args as number[];
  if (op === pdfjs.OPS.setFillRGBColor) {
    const value = args[0];
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) return value.slice(1).toUpperCase();
    if (values.length >= 3 && values.slice(0, 3).every((item) => Number.isFinite(Number(item)))) {
      return hexColor(Number(values[0]), Number(values[1]), Number(values[2]));
    }
  }
  if (op === pdfjs.OPS.setFillGray) {
    const gray = Number(args[0]);
    if (Number.isFinite(gray)) return hexColor(gray, gray, gray);
  }
  if (op === pdfjs.OPS.setFillCMYKColor) {
    const [c, m, y, k] = values.map(Number);
    if ([c, m, y, k].every(Number.isFinite)) {
      return hexColor((1 - Math.min(1, c + k)), (1 - Math.min(1, m + k)), (1 - Math.min(1, y + k)));
    }
  }
  if (op === pdfjs.OPS.setFillColor || op === pdfjs.OPS.setFillColorN) {
    const components = values.filter((value) => Number.isFinite(Number(value))).map(Number);
    if (components.length === 1) return hexColor(components[0], components[0], components[0]);
    if (components.length >= 3) return hexColor(components[0], components[1], components[2]);
    if (components.length === 4) {
      const [c, m, y, k] = components;
      return hexColor(1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k));
    }
  }
  return undefined;
}

function glyphText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(glyphText).join("");
  if (value && typeof value === "object" && "unicode" in value) {
    const unicode = (value as { unicode?: unknown }).unicode;
    return typeof unicode === "string" ? unicode : "";
  }
  return "";
}

/**
 * PDF.js text items do not expose fill colour. The operator list does: every
 * show-text operation runs after a fill-colour operator. Build colour runs and
 * map them onto text items by character position, preserving black as the
 * default so ordinary documents stay unchanged.
 */
export function detectTextItemColors(
  pdfjs: PdfJsModule,
  operatorList: { fnArray: readonly number[]; argsArray: readonly unknown[] },
  items: readonly unknown[],
): (string | undefined)[] {
  const { fnArray, argsArray } = operatorList;
  if (!Array.isArray(fnArray) || !Array.isArray(argsArray)) return [];
  const showOps = new Set([pdfjs.OPS.showText, pdfjs.OPS.showSpacedText, pdfjs.OPS.nextLineShowText, pdfjs.OPS.nextLineSetSpacingShowText].filter((op) => typeof op === "number"));
  const colorStack: string[] = [];
  const runs: Array<{ color: string; text: string }> = [];
  let current = "000000";
  for (let index = 0; index < fnArray.length; index += 1) {
    const op = fnArray[index];
    const args = argsArray[index] as readonly unknown[];
    if (op === pdfjs.OPS.save) {
      colorStack.push(current);
      continue;
    }
    if (op === pdfjs.OPS.restore) {
      current = colorStack.pop() ?? "000000";
      continue;
    }
    const color = fillColorFromOperator(pdfjs, op, Array.isArray(args) ? args : []);
    if (color) {
      current = color;
      continue;
    }
    if (!showOps.has(op)) continue;
    const text = glyphText(args?.[0]);
    if (text) runs.push({ color: current, text });
  }
  if (!runs.length) return [];
  const activeRuns = runs.filter((run) => run.text.length > 0);
  if (!activeRuns.length) return [];
  let runIndex = 0;
  let runRemaining = activeRuns[0].text.length;
  const colors: (string | undefined)[] = [];
  for (const candidate of items) {
    const text = (candidate as { str?: unknown }).str;
    if (typeof text !== "string" || !text.trim()) {
      colors.push(undefined);
      continue;
    }
    let remaining = text.length;
    const weights = new Map<string, number>();
    while (remaining > 0 && runIndex < activeRuns.length) {
      if (runRemaining <= 0) {
        runIndex += 1;
        runRemaining = activeRuns[runIndex]?.text.length ?? 0;
        continue;
      }
      const take = Math.min(remaining, runRemaining);
      const color = activeRuns[runIndex].color;
      weights.set(color, (weights.get(color) ?? 0) + take);
      remaining -= take;
      runRemaining -= take;
    }
    const dominant = [...weights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? activeRuns[activeRuns.length - 1].color;
    colors.push(dominant === "000000" ? undefined : dominant);
  }
  return colors;
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
        let itemColors: (string | undefined)[] = [];
        let rules: number[] = [];
        let verticalRules: { x: number; y0: number; y1: number }[] = [];
        try {
          const operatorList = await page.getOperatorList();
          const list = operatorList as unknown as { fnArray: readonly number[]; argsArray: readonly unknown[] };
          fontStyles = resolvePdfFontStyles(page, Object.keys(content.styles));
          itemColors = detectTextItemColors(pdfjs, list, content.items as unknown[]);
          rules = detectHorizontalRules(pdfjs, list, viewport);
          verticalRules = detectVerticalRules(pdfjs, list);
        } catch {
          // Some damaged pages cannot provide an operator list; text still works.
        }
        const raw = normalisePageTextItems(pdfjs, content.items as unknown[], viewport, fontStyles, itemColors);
        const structure = buildPdfPageStructure(raw, viewport.width, viewport.height, pageNumber, rules, verticalRules);
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
