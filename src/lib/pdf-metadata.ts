import { PDFDocument } from "@cantoo/pdf-lib";
import { PDF_LIMITS, checkPdfHeader } from "./pdf-limits";

export const METADATA_FIELDS = ["title", "author", "subject", "keywords", "creator", "producer"] as const;
export type PdfMetadata = Record<typeof METADATA_FIELDS[number], string>;

export function readMetadata(pdf: PDFDocument): PdfMetadata {
  return { title: pdf.getTitle() ?? "", author: pdf.getAuthor() ?? "", subject: pdf.getSubject() ?? "", keywords: pdf.getKeywords() ?? "", creator: pdf.getCreator() ?? "", producer: pdf.getProducer() ?? "" };
}

export async function inspectPdfMetadata(bytes: Uint8Array) {
  if (!bytes.byteLength) throw new Error("Choose a non-empty PDF.");
  if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new Error("The PDF exceeds the 50 MB input limit.");
  if (!checkPdfHeader(bytes)) throw new Error("This file does not have a PDF signature.");
  let pdf: PDFDocument;
  let pageCount: number; let metadata: PdfMetadata;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); pageCount = pdf.getPageCount(); metadata = readMetadata(pdf); }
  catch { throw new Error("This PDF could not be opened. It may be corrupt, encrypted, or unsupported."); }
  if (pageCount < 1 || pageCount > PDF_LIMITS.pages) throw new Error("The PDF must contain 1-500 pages.");
  return { metadata, pageCount };
}

export async function updatePdfMetadata(bytes: Uint8Array, metadata: PdfMetadata) {
  const { pageCount } = await inspectPdfMetadata(bytes);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const normalized = Object.fromEntries(METADATA_FIELDS.map((field) => [field, metadata[field].trim()])) as PdfMetadata;
  normalized.keywords = normalized.keywords.split(/[,\s]+/).filter(Boolean).join(" ");
  for (const value of Object.values(normalized)) {
    if (value.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("Metadata fields must be at most 1,000 characters and contain no control characters.");
  }
  pdf.setTitle(normalized.title); pdf.setAuthor(normalized.author); pdf.setSubject(normalized.subject);
  pdf.setKeywords(normalized.keywords ? normalized.keywords.split(/[,\s]+/).filter(Boolean) : []);
  pdf.setCreator(normalized.creator); pdf.setProducer(normalized.producer);
  const output = new Uint8Array(await pdf.save({ useObjectStreams: true }));
  try {
    if (output.byteLength > PDF_LIMITS.perFileBytes || !checkPdfHeader(output)) throw new Error("The updated PDF failed its signature or file-size validation.");
    const checked = await PDFDocument.load(output, { updateMetadata: false });
    const actual = readMetadata(checked);
    if (checked.getPageCount() !== pageCount || METADATA_FIELDS.some((field) => actual[field] !== normalized[field])) throw new Error("The updated PDF failed its metadata or page-count check.");
    return output;
  } catch (error) { output.fill(0); throw error; }
}
