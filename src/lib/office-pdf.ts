import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";

export const PDF_EXPORT_LIMITS = {
  margin: 54,
  fontSize: 11,
  lineHeight: 1.45,
  tableFontSize: 8,
  maxTableColumns: 12,
} as const;

const REPLACEMENTS: Record<string, string> = {
  "\u2018": "'", "\u2019": "'", "\u201A": ",", "\u201B": "'",
  "\u201C": '"', "\u201D": '"', "\u201E": '"',
  "\u2013": "-", "\u2014": "-", "\u2022": "-", "\u2026": "...",
  "\u00A0": " ", "\u2028": "\n", "\u2029": "\n", "\u2043": "-", "\u2212": "-",
};

/** pdf-lib standard fonts use WinAnsi; map or drop characters they cannot encode. */
export function toPdfSafeText(value: string): string {
  let output = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const replacement = REPLACEMENTS[character];
    if (replacement !== undefined) { output += replacement; continue; }
    if (character === "\n") { output += "\n"; continue; }
    if (character === "\t") { output += "    "; continue; }
    if (code >= 32 && code <= 255) { output += character; continue; }
    if (code > 255) output += "?";
  }
  return output;
}

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { current = candidate; continue; }
    if (current) lines.push(current);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) { current = word; continue; }
    let fragment = "";
    for (const character of word) {
      if (fragment && font.widthOfTextAtSize(fragment + character, size) > maxWidth) { lines.push(fragment); fragment = character; }
      else fragment += character;
    }
    current = fragment;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

type Cursor = { page: PDFPage; y: number; font: PDFFont; bold: PDFFont; size: number; width: number; height: number; margin: number };

function newPage(doc: PDFDocument, width: number, height: number, margin: number, font: PDFFont, bold: PDFFont, size: number): Cursor {
  return { page: doc.addPage([width, height]), y: height - margin, font, bold, size, width, height, margin };
}

function writeLine(
  doc: PDFDocument,
  start: Cursor,
  text: string,
  options: { size?: number; bold?: boolean; color?: [number, number, number] } = {},
): Cursor {
  let cursor = start;
  const size = options.size ?? cursor.size;
  const font = options.bold ? cursor.bold : cursor.font;
  const maxWidth = cursor.width - cursor.margin * 2;
  for (const line of wrapText(text, font, size, maxWidth)) {
    if (cursor.y - size * PDF_EXPORT_LIMITS.lineHeight < cursor.margin) {
      cursor = newPage(doc, cursor.width, cursor.height, cursor.margin, cursor.font, cursor.bold, cursor.size);
    }
    const [red, green, blue] = options.color ?? [0.12, 0.13, 0.17];
    cursor.page.drawText(line, { x: cursor.margin, y: cursor.y - size, size, font, color: rgb(red, green, blue) });
    cursor.y -= size * PDF_EXPORT_LIMITS.lineHeight;
  }
  return cursor;
}

export async function buildParagraphPdf(paragraphs: string[], title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(toPdfSafeText(title));
  doc.setProducer("APOS");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let cursor = newPage(doc, 595.28, 841.89, PDF_EXPORT_LIMITS.margin, font, bold, PDF_EXPORT_LIMITS.fontSize);
  cursor = writeLine(doc, cursor, toPdfSafeText(title), { size: 18, bold: true });
  cursor.y -= 10;
  for (const paragraph of paragraphs) {
    cursor = writeLine(doc, cursor, toPdfSafeText(paragraph));
    cursor.y -= 4;
  }
  return doc.save();
}

export function normaliseTable(rows: string[][]): string[][] {
  const width = Math.min(PDF_EXPORT_LIMITS.maxTableColumns, rows.reduce((max, row) => Math.max(max, row.length), 1));
  return rows.map((row) => Array.from({ length: width }, (_, index) => toPdfSafeText(row[index] ?? "")));
}

export async function buildTablePdf(rows: string[][], title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(toPdfSafeText(title));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const table = normaliseTable(rows);
  const columns = Math.max(1, table[0]?.length ?? 1);
  const width = 841.89;
  const height = 595.28;
  const margin = 36;
  const usable = width - margin * 2;
  const rowHeight = 14;
  const columnWidth = usable / columns;
  let cursor = newPage(doc, width, height, margin, font, bold, PDF_EXPORT_LIMITS.tableFontSize);
  cursor = writeLine(doc, cursor, toPdfSafeText(title), { size: 14, bold: true });
  cursor.y -= 6;

  table.forEach((row, rowIndex) => {
    if (cursor.y - rowHeight < margin) {
      cursor = newPage(doc, width, height, margin, font, bold, PDF_EXPORT_LIMITS.tableFontSize);
    }
    const top = cursor.y;
    row.forEach((cell, index) => {
      const text = cell.length > 60 ? `${cell.slice(0, 57)}...` : cell;
      cursor.page.drawText(text, {
        x: margin + index * columnWidth + 3,
        y: top - 10,
        size: PDF_EXPORT_LIMITS.tableFontSize,
        font: rowIndex === 0 ? bold : font,
        color: rgb(0.12, 0.13, 0.17),
      });
    });
    cursor.page.drawLine({
      start: { x: margin, y: top - rowHeight + 2 },
      end: { x: width - margin, y: top - rowHeight + 2 },
      thickness: 0.4,
      color: rgb(0.8, 0.81, 0.85),
    });
    cursor.y = top - rowHeight;
  });
  return doc.save();
}

export async function buildSlidesPdf(slides: string[][], title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(toPdfSafeText(title));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  slides.forEach((slide, index) => {
    let cursor = newPage(doc, 841.89, 595.28, 48, font, bold, 14);
    const [heading, ...rest] = slide.length ? slide : [`Slide ${index + 1}`];
    cursor = writeLine(doc, cursor, `${index + 1}. ${toPdfSafeText(heading)}`, { size: 22, bold: true });
    cursor.y -= 12;
    if (rest.length) {
      for (const line of rest) cursor = writeLine(doc, cursor, `- ${toPdfSafeText(line)}`, { size: 14 });
    } else {
      writeLine(doc, cursor, "(no text content on this slide)", { size: 12, color: [0.45, 0.46, 0.52] });
    }
  });
  if (!slides.length) {
    const cursor = newPage(doc, 841.89, 595.28, 48, font, bold, 14);
    writeLine(doc, cursor, "This presentation contained no readable text.", { size: 16 });
  }
  return doc.save();
}

/** Lays out text and pictures together, preserving the order they arrive in. */
export async function buildBlocksPdf(blocks: Array<{ kind: "text"; text: string } | { kind: "image"; bytes: Uint8Array; format: "png" | "jpeg"; width: number; height: number }>, title: string): Promise<Uint8Array>;
export async function buildBlocksPdf(
  blocks: Array<{ kind: "text"; text: string } | { kind: "image"; bytes: Uint8Array; format: "png" | "jpeg"; width: number; height: number }>,
  title: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(toPdfSafeText(title));
  doc.setProducer("APOS");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let cursor = newPage(doc, 595.28, 841.89, PDF_EXPORT_LIMITS.margin, font, bold, PDF_EXPORT_LIMITS.fontSize);
  cursor = writeLine(doc, cursor, toPdfSafeText(title), { size: 18, bold: true });
  cursor.y -= 10;
  const contentWidth = cursor.width - cursor.margin * 2;
  for (const block of blocks) {
    if (block.kind === "text") {
      cursor = writeLine(doc, cursor, toPdfSafeText(block.text));
      cursor.y -= 4;
      continue;
    }
    let image;
    try {
      image = block.format === "png" ? await doc.embedPng(block.bytes) : await doc.embedJpg(block.bytes);
    } catch { continue; }
    const scale = Math.min(1, contentWidth / image.width, (cursor.height - cursor.margin * 2) / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    if (cursor.y - drawHeight < cursor.margin) cursor = newPage(doc, cursor.width, cursor.height, cursor.margin, cursor.font, cursor.bold, cursor.size);
    cursor.page.drawImage(image, { x: cursor.margin, y: cursor.y - drawHeight, width: drawWidth, height: drawHeight });
    cursor.y -= drawHeight + 10;
  }
  return doc.save();
}
