import { PDFDocument } from "@cantoo/pdf-lib";
import { convertImageFile, type ImageOutputFormat } from "./image-convert";
import { convertOffice, type OfficeMode } from "./office-convert";
import { convertPdfToOffice } from "./pdf-to-office";
import { buildDocx, buildXlsx, readDocxParagraphs, readPptxSlides, readXlsxRows } from "./office-formats";
import { buildParagraphPdf } from "./office-pdf";
import { convertPdfFileToText } from "./pdf-to-text";

export type Target = "pdf" | "docx" | "xlsx" | "pptx" | "png" | "jpeg" | "webp" | "txt" | "csv" | "html";
export type SourceKind = "pdf" | "docx" | "xlsx" | "pptx" | "png" | "jpeg" | "webp" | "tiff" | "text" | "csv" | "json" | "unknown";

export const TARGET_LABELS: Record<Target, string> = {
  pdf: "PDF",
  docx: "Word (.docx)",
  xlsx: "Excel (.xlsx)",
  pptx: "PowerPoint (.pptx)",
  png: "PNG image",
  jpeg: "JPG image",
  webp: "WebP image",
  txt: "plain text",
  csv: "CSV",
  html: "HTML page",
};

const MIME: Record<Target, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  txt: "text/plain;charset=utf-8",
  csv: "text/csv;charset=utf-8",
  html: "text/html;charset=utf-8",
};

const EXTENSION: Record<Target, string> = { pdf: "pdf", docx: "docx", xlsx: "xlsx", pptx: "pptx", png: "png", jpeg: "jpg", webp: "webp", txt: "txt", csv: "csv", html: "html" };

const ALIASES: [Target, RegExp][] = [
  ["docx", /\b(word|docx?|document)\b/i],
  ["xlsx", /\b(excel|xlsx|spreadsheet|xls)\b/i],
  ["pptx", /\b(powerpoint|pptx?|slides?|deck|presentation)\b/i],
  ["pdf", /\bpdf\b/i],
  ["png", /\bpng\b/i],
  ["jpeg", /\b(jpe?g|jpg)\b/i],
  ["webp", /\bwebp\b/i],
  ["txt", /\b(text|txt|plain)\b/i],
  ["csv", /\bcsv\b/i],
  ["html", /\bhtml?\b/i],
];

/** Reads a natural-language request such as "make it a pdf" or "convert to word". */
export function canonicalTarget(request: string): Target | null {
  for (const [target, pattern] of ALIASES) {
    if (pattern.test(request)) return target;
  }
  const bare = request.trim().toLowerCase().replace(/^\./, "");
  return (Object.keys(TARGET_LABELS) as Target[]).find((target) => target === bare) ?? null;
}

export function detectKind(name: string, bytes: Uint8Array): SourceKind {
  const head = bytes.subarray(0, 12);
  const ascii = (offset: number, length: number) => String.fromCharCode(...head.subarray(offset, offset + length));
  if (ascii(0, 4) === "%PDF") return "pdf";
  if (head[0] === 0x89 && ascii(1, 3) === "PNG") return "png";
  if (head[0] === 0xff && head[1] === 0xd8) return "jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  if ((ascii(0, 2) === "II" && head[2] === 42) || (ascii(0, 2) === "MM" && head[3] === 42)) return "tiff";
  if (ascii(0, 2) === "PK") {
    const lower = name.toLowerCase();
    if (lower.endsWith(".docx")) return "docx";
    if (lower.endsWith(".xlsx")) return "xlsx";
    if (lower.endsWith(".pptx")) return "pptx";
    return "unknown";
  }
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md") || lower.endsWith(".txt")) return "text";
  return "unknown";
}

const IMAGE_KINDS: SourceKind[] = ["png", "jpeg", "webp", "tiff"];
const OFFICE_KINDS: SourceKind[] = ["docx", "xlsx", "pptx"];
const TEXT_KINDS: SourceKind[] = ["text", "csv", "json"];

export type Plan = { supported: true; description: string } | { supported: false; reason: string };

export function planConversion(kind: SourceKind, target: Target): Plan {
  if (kind === "unknown") return { supported: false, reason: "This file type is not recognised. Supported inputs: PDF, Word, Excel, PowerPoint, PNG, JPG, WebP, TIFF, text, CSV and JSON." };
  if (kind === target) return { supported: false, reason: `The file is already ${TARGET_LABELS[target]}.` };
  if (IMAGE_KINDS.includes(kind)) {
    if (target === "png" || target === "jpeg" || target === "webp") return { supported: true, description: `Re-encode the image as ${TARGET_LABELS[target]}.` };
    if (target === "pdf") return { supported: true, description: "Place the image on a PDF page." };
  }
  if (kind === "pdf") {
    if (target === "docx" || target === "xlsx") return { supported: true, description: "Rebuild the PDF into an editable office file; image-only pages need OCR or Visual Word." };
    if (target === "txt") return { supported: true, description: "Extract the PDF text." };
  }
  if (OFFICE_KINDS.includes(kind)) {
    if (target === "pdf") return { supported: true, description: "Lay the office file out as a PDF." };
    if (target === "txt") return { supported: true, description: "Extract the readable text." };
    if (kind === "xlsx" && target === "csv") return { supported: true, description: "Export the first worksheet as CSV." };
  }
  if (TEXT_KINDS.includes(kind)) {
    if (target === "pdf") return { supported: true, description: "Reflow the text into a PDF." };
    if (target === "docx") return { supported: true, description: "Reflow the text into a Word document." };
    if (kind === "csv" && target === "xlsx") return { supported: true, description: "Build an Excel workbook from the CSV rows." };
  }
  return { supported: false, reason: `Converting ${kind.toUpperCase()} to ${TARGET_LABELS[target]} is not supported yet. The AI document agent can rewrite documents, and the individual tools cover the other paths.` };
}

const IMAGE_TARGETS: Record<string, ImageOutputFormat> = { png: "png", jpeg: "jpeg", webp: "webp" };

export type UniversalResult = { bytes: Uint8Array; fileName: string; mime: string; detail: string };

export async function convertUniversal(
  file: File,
  target: Target,
  options: { signal: AbortSignal; onProgress: (message: string) => void },
): Promise<UniversalResult> {
  const { signal, onProgress } = options;
  const buffer = new Uint8Array(await file.arrayBuffer());
  const kind = detectKind(file.name, buffer);
  const plan = planConversion(kind, target);
  if (!plan.supported) throw new Error(plan.reason);
  const stem = (file.name.replace(/\.[^.]+$/, "") || "document").replace(/[^\w\-. ]+/g, "-");
  const finish = (bytes: Uint8Array, detail: string): UniversalResult => ({ bytes, fileName: `${stem}.${EXTENSION[target]}`, mime: MIME[target], detail });
  const asFile = () => new File([buffer as unknown as BlobPart], file.name);

  if (IMAGE_KINDS.includes(kind)) {
    if (target === "pdf") {
      onProgress("Placing the image on a PDF page…");
      const imageFormat = IMAGE_TARGETS[kind] ? kind : "png";
      const prepared = imageFormat === kind
        ? { bytes: buffer, mime: MIME[kind as Target] }
        : await convertImageFile(asFile(), "png", {}, signal, () => {});
      const doc = await PDFDocument.create();
      const embedded = imageFormat === "jpeg" ? await doc.embedJpg(prepared.bytes) : await doc.embedPng(prepared.bytes);
      const page = doc.addPage([embedded.width, embedded.height]);
      page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
      return finish(await doc.save(), "The image became a single PDF page at its native size.");
    }
    onProgress(`Re-encoding as ${TARGET_LABELS[target]}…`);
    const result = await convertImageFile(asFile(), IMAGE_TARGETS[target], {}, signal, () => {});
    return finish(result.bytes, `Re-encoded as ${TARGET_LABELS[target]} without resizing.`);
  }

  if (kind === "pdf") {
    if (target === "docx" || target === "xlsx") {
      const converted = await convertPdfToOffice(asFile(), {
        format: target,
        mode: "editable",
        pages: "",
        includeTables: true,
        includePictures: true,
        pageBreaks: true,
        ocrScannedPages: false,
      }, { signal, onProgress });
      return { bytes: converted.bytes, fileName: converted.fileName, mime: converted.mime, detail: converted.detail };
    }
    const extracted = await convertPdfFileToText(asFile(), { includePageLabels: false }, signal, ({ completedPages, totalPages }) => onProgress(`Reading page ${completedPages} of ${totalPages}…`));
    return finish(extracted.bytes, `Extracted text from ${extracted.pageCount} page(s).`);
  }

  if (OFFICE_KINDS.includes(kind)) {
    if (target === "pdf") {
      const mode: OfficeMode = kind === "docx" ? "document-to-pdf" : kind === "xlsx" ? "spreadsheet-to-pdf" : "presentation-to-pdf";
      return convertOffice(mode, asFile(), { signal, onProgress });
    }
    onProgress("Extracting the text…");
    if (kind === "docx") return finish(new TextEncoder().encode(readDocxParagraphs(buffer).join("\n\n")), "Extracted the paragraph text.");
    if (kind === "xlsx") {
      const rows = readXlsxRows(buffer);
      if (target === "csv") return finish(new TextEncoder().encode(rows.map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",")).join("\n")), `Exported ${rows.length} row(s) from the first worksheet.`);
      return finish(new TextEncoder().encode(rows.map((row) => row.join("\t")).join("\n")), `Extracted ${rows.length} row(s) as tab-separated text.`);
    }
    return finish(new TextEncoder().encode(readPptxSlides(buffer).map((slide, index) => `Slide ${index + 1}\n${slide.join("\n")}`).join("\n\n")), "Extracted the slide text.");
  }

  const text = new TextDecoder().decode(buffer);
  if (target === "pdf") {
    onProgress("Laying out the PDF…");
    const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    if (!paragraphs.length) throw new Error("This file has no readable text.");
    return finish(await buildParagraphPdf(paragraphs, stem), `${paragraphs.length} paragraph(s) reflowed into a PDF.`);
  }
  if (target === "docx") {
    const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    if (!paragraphs.length) throw new Error("This file has no readable text.");
    return finish(buildDocx(paragraphs, stem), `${paragraphs.length} paragraph(s) written into a Word document.`);
  }
  if (kind === "csv" && target === "xlsx") {
    const { parseDelimited } = await import("./office-convert");
    const rows = parseDelimited(text);
    if (!rows.length) throw new Error("This CSV file has no rows.");
    return finish(buildXlsx(rows, stem), `${rows.length} row(s) written into an Excel workbook.`);
  }
  throw new Error(`Converting ${kind.toUpperCase()} to ${TARGET_LABELS[target]} is not available in this build.`);
}
