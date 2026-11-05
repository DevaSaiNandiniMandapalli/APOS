import { unzipSync } from "fflate";
import { convertPdfFileToText } from "./pdf-to-text";

export const SUMMARY_INPUT_LIMIT = 12000;

export type ExtractedDocument = { text: string; kind: "pdf" | "docx" | "text"; pages?: number };

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (match) => ENTITIES[match] ?? match);
}

export function docxXmlToText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeExtractedText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildExcerpt(text: string, limit = SUMMARY_INPUT_LIMIT): { excerpt: string; truncated: boolean; totalCharacters: number } {
  const normalized = text.trim();
  if (normalized.length <= limit) return { excerpt: normalized, truncated: false, totalCharacters: normalized.length };
  const cut = normalized.slice(0, limit);
  const boundary = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  const excerpt = boundary > limit * 0.6 ? cut.slice(0, boundary + 1) : cut;
  return { excerpt: excerpt.trim(), truncated: true, totalCharacters: normalized.length };
}

export function isSupportedDocumentName(name: string): boolean {
  return /\.(pdf|docx|txt|md|csv|json)$/i.test(name);
}

export async function extractDocumentText(
  file: File,
  signal: AbortSignal,
  onProgress: (message: string) => void,
): Promise<ExtractedDocument> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    onProgress("Extracting text from the PDF…");
    const result = await convertPdfFileToText(file, { includePageLabels: true }, signal, (progress) => {
      onProgress(`Reading page ${progress.completedPages} of ${progress.totalPages}…`);
    });
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(result.bytes);
      return { text: normalizeExtractedText(text), kind: "pdf", pages: result.pageCount };
    } finally {
      result.bytes.fill(0);
    }
  }

  const buffer = await file.arrayBuffer();
  if (name.endsWith(".docx")) {
    onProgress("Reading the Word document…");
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(buffer));
    } catch {
      throw new Error("This .docx file could not be opened. It may be damaged or password protected.");
    }
    const documentXml = entries["word/document.xml"];
    if (!documentXml) throw new Error("This .docx file has no readable document body.");
    return { text: normalizeExtractedText(docxXmlToText(new TextDecoder().decode(documentXml))), kind: "docx" };
  }

  if (/\.(txt|md|csv|json)$/i.test(name)) {
    onProgress("Reading the text…");
    return { text: normalizeExtractedText(new TextDecoder().decode(buffer)), kind: "text" };
  }

  throw new Error("Use a PDF, Word (.docx), text, Markdown, CSV or JSON file.");
}
