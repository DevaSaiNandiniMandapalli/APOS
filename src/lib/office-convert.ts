import { OFFICE_LIMITS, readDocxBlocks, readPptxSlides, readXlsxRows } from "./office-formats";
import { buildBlocksPdf, buildParagraphPdf, buildSlidesPdf, buildTablePdf } from "./office-pdf";

export type OfficeMode = "document-to-pdf" | "spreadsheet-to-pdf" | "presentation-to-pdf";

export type ModeCopy = {
  heading: string;
  description: string;
  accept: string;
  action: string;
};

export const MODE_COPY: Record<OfficeMode, ModeCopy> = {
  "document-to-pdf": {
    heading: "Convert a document to PDF",
    description: "Turn a Word (.docx), text, Markdown, CSV or JSON file into a paginated PDF. Text is reflowed into a clean document layout.",
    accept: ".docx,.txt,.md,.csv,.json,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,application/json",
    action: "Create PDF",
  },
  "spreadsheet-to-pdf": {
    heading: "Convert a spreadsheet to PDF",
    description: "Print an Excel (.xlsx) workbook or CSV/TSV file as a paginated PDF table, one row per line.",
    accept: ".xlsx,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values",
    action: "Create PDF",
  },
  "presentation-to-pdf": {
    heading: "Convert a presentation to PDF",
    description: "Export the text of a PowerPoint (.pptx) deck into a landscape PDF, one page per slide.",
    accept: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation",
    action: "Create PDF",
  },
};

export type ConversionResult = { bytes: Uint8Array; fileName: string; mime: string; detail: string };

const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export function baseName(name: string): string {
  const stem = (name.replace(/\.[^.]+$/, "") || "document")
    .replace(/[^\w\-. ]+/g, "-")
    .replace(/^[.\- ]+|[.\- ]+$/g, "")
    .slice(0, 60)
    .trim();
  return stem || "document";
}

export function parseDelimited(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1; }
        else quoted = false;
      } else cell += character;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === delimiter) { row.push(cell); cell = ""; continue; }
    if (character === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    if (character === "\r") continue;
    cell += character;
  }
  row.push(cell);
  if (row.length > 1 || row[0]) rows.push(row);
  return rows.map((values) => values.map((value) => value.trim()));
}

export function paragraphsFromPlainText(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.split("\n").map((line) => line.trimEnd()).join("\n").trim())
    .filter(Boolean);
}

export async function convertOffice(
  mode: OfficeMode,
  file: File,
  options: { signal: AbortSignal; onProgress: (message: string) => void },
): Promise<ConversionResult> {
  const { signal, onProgress } = options;
  const name = baseName(file.name);

  const buffer = new Uint8Array(await file.arrayBuffer());
  if (signal.aborted) throw new DOMException("Conversion cancelled", "AbortError");

  if (mode === "document-to-pdf") {
    onProgress("Reading the document…");
    const isDocx = /\.docx$/i.test(file.name);
    const blocks = isDocx
      ? readDocxBlocks(buffer)
      : paragraphsFromPlainText(new TextDecoder().decode(buffer)).map((text) => ({ kind: "text" as const, text }));
    if (!blocks.length) throw new Error("This document has no readable content.");
    if (blocks.length > OFFICE_LIMITS.maxParagraphs) throw new Error(`This document has more than ${OFFICE_LIMITS.maxParagraphs} items. Split it first.`);
    onProgress("Laying out the PDF…");
    const pictures = blocks.filter((block) => block.kind === "image").length;
    return {
      bytes: isDocx ? await buildBlocksPdf(blocks, name) : await buildParagraphPdf(blocks.map((block) => (block.kind === "text" ? block.text : "")), name),
      fileName: `${name}.pdf`,
      mime: MIME.pdf,
      detail: isDocx
        ? `${blocks.length} item(s) reflowed into a new PDF${pictures ? `, including ${pictures} picture(s)` : ""}.`
        : `${blocks.length} paragraph(s) reflowed into a new PDF.`,
    };
  }

  if (mode === "spreadsheet-to-pdf") {
    onProgress("Reading the spreadsheet…");
    let rows: string[][];
    if (/\.xlsx$/i.test(file.name)) rows = readXlsxRows(buffer);
    else {
      const text = new TextDecoder().decode(buffer);
      rows = parseDelimited(text, /\.tsv$/i.test(file.name) ? "\t" : ",");
    }
    if (!rows.length) throw new Error("This spreadsheet has no readable rows.");
    onProgress("Laying out the PDF table…");
    return {
      bytes: await buildTablePdf(rows, name),
      fileName: `${name}.pdf`,
      mime: MIME.pdf,
      detail: `${rows.length} row(s) printed as a table${rows[0].length > 12 ? " (first 12 columns)" : ""}.`,
    };
  }

  onProgress("Reading the slides…");
  const slides = readPptxSlides(buffer);
  if (!slides.length) throw new Error("This presentation has no readable slides.");
  if (slides.length > OFFICE_LIMITS.maxSlides) throw new Error(`This deck has more than ${OFFICE_LIMITS.maxSlides} slides. Split it first.`);
  onProgress("Laying out the PDF…");
  return {
    bytes: await buildSlidesPdf(slides, name),
    fileName: `${name}.pdf`,
    mime: MIME.pdf,
    detail: `${slides.length} slide(s) exported as text pages. Images and animations are not carried over.`,
  };
}
