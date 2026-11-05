import { PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS, PdfInputError } from "./pdf-limits";

export type StructureIssueCode = "missing-eof" | "truncated" | "bad-startxref" | "missing-trailer" | "missing-xref" | "no-page-tree";

export type StructureIssue = { code: StructureIssueCode; label: string };

const ISSUE_LABELS: Record<StructureIssueCode, string> = {
  "missing-eof": "The file does not end with a %%EOF marker, so readers may stop before the last update.",
  truncated: "The file ends mid-section and looks truncated.",
  "bad-startxref": "The final startxref offset does not point at a cross-reference section.",
  "missing-trailer": "No trailer dictionary was found, so the document catalog cannot be located reliably.",
  "missing-xref": "No cross-reference table or stream is present.",
  "no-page-tree": "No page tree was found in the raw bytes.",
};

export function diagnosePdf(bytes: Uint8Array): StructureIssue[] {
  const text = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.byteLength - 65536)));
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const issues: StructureIssue[] = [];
  const add = (code: StructureIssueCode) => issues.push({ code, label: ISSUE_LABELS[code] });

  if (!/%%EOF\s*$/.test(text)) add(/%%EOF/.test(text) ? "truncated" : "missing-eof");
  if (!/\/Root\s/.test(text)) add("missing-trailer");

  const startxref = /startxref\s+(\d+)/.exec(text);
  if (!startxref) add("bad-startxref");
  else {
    const offset = Number(startxref[1]);
    const at = offset >= 0 && offset < bytes.byteLength
      ? new TextDecoder("latin1").decode(bytes.subarray(offset, Math.min(bytes.byteLength, offset + 32)))
      : "";
    if (!/^\s*(xref|\d+\s+\d+\s+obj)/.test(at)) add("bad-startxref");
  }

  if (!/\bxref\b|\/Type\s*\/XRef/.test(head) && !/\bxref\b|\/Type\s*\/XRef/.test(text)) add("missing-xref");
  if (!/\/Type\s*\/Pages/.test(head) && !/\/Type\s*\/Pages/.test(text)) add("no-page-tree");
  return issues.filter((issue, index) => issues.findIndex((item) => item.code === issue.code) === index);
}

export type RepairReport = {
  pagesTotal: number;
  pagesRecovered: number;
  droppedPages: number[];
  issues: StructureIssue[];
  metadataRestored: string[];
  notes: string[];
  annotationsPreserved: number;
  verified: boolean;
  inputBytes: number;
  outputBytes: number;
};

export async function repairPdfBuffer(bytes: Uint8Array): Promise<{ bytes: Uint8Array; report: RepairReport }> {
  if (bytes.byteLength === 0) throw new PdfInputError("empty", "The selected file is empty.");
  if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new PdfInputError("too-large", "The PDF exceeds the 50 MB file limit.");
  if (!checkPdfHeader(bytes)) throw new PdfInputError("wrong-signature", "This file does not have a PDF signature.");

  const issues = diagnosePdf(bytes);
  const encrypted = /\/Encrypt\s/.test(new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.byteLength - 65536))));
  if (encrypted) throw new PdfInputError("invalid-pdf", "This PDF is encrypted. Remove the password with the owner's permission first, then repair it.");

  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
  } catch {
    throw new PdfInputError("invalid-pdf", "This file is too damaged to rebuild in the browser. No page structure could be read.");
  }
  const pagesTotal = source.getPageCount();
  if (pagesTotal < 1) throw new PdfInputError("invalid-pdf", "No pages could be read from this document.");
  if (pagesTotal > PDF_LIMITS.pages) throw new PdfInputError("too-many-pages", `The document must contain 1-${PDF_LIMITS.pages} pages.`);

  const target = await PDFDocument.create();
  const droppedPages: number[] = [];
  let annotationsPreserved = 0;
  for (let index = 0; index < pagesTotal; index += 1) {
    try {
      const [page] = await target.copyPages(source, [index]);
      annotationsPreserved += page.node.Annots()?.size() ?? 0;
      target.addPage(page);
    } catch {
      droppedPages.push(index + 1);
    }
  }
  const pagesRecovered = target.getPageCount();
  if (!pagesRecovered) throw new PdfInputError("invalid-pdf", "No page could be salvaged from this file.");

  const metadataRestored: string[] = [];
  const notes: string[] = [];
  const carry = (key: "Title" | "Author" | "Subject" | "Keywords", read: () => string | undefined, write: (value: string) => void) => {
    let value: string | undefined;
    try { value = read(); } catch { value = undefined; }
    if (value && value.trim()) { write(value); metadataRestored.push(key); }
  };
  carry("Title", () => source.getTitle(), (value) => target.setTitle(value));
  carry("Author", () => source.getAuthor(), (value) => target.setAuthor(value));
  carry("Subject", () => source.getSubject(), (value) => target.setSubject(value));
  carry("Keywords", () => source.getKeywords(), (value) => target.setKeywords(value.split(/[;,]\s*|\s{2,}/).filter(Boolean)));

  const rawText = new TextDecoder("latin1").decode(bytes);
  if (!metadataRestored.length && /\/Info\b/.test(rawText)) {
    notes.push("Document information was referenced but could not be read from the damaged file, so the title and author were not restored.");
  }
  if (droppedPages.length) notes.push(`${droppedPages.length} page${droppedPages.length === 1 ? "" : "s"} could not be read and were left out of the repaired file.`);

  const output = new Uint8Array(await target.save({ useObjectStreams: true }));
  try {
    if (output.byteLength > PDF_LIMITS.perFileBytes) throw new PdfInputError("too-large", "The repaired PDF exceeds the 50 MB output limit.");
    const verified = await PDFDocument.load(output, { updateMetadata: false });
    const verifiedPages = verified.getPages();
    const pagesMatch = verifiedPages.length === pagesRecovered;
    let pageSizesMatch = true;
    for (let index = 0; index < verifiedPages.length; index += 1) {
      const expected = target.getPage(index).getSize();
      const actual = verifiedPages[index].getSize();
      if (actual.width !== expected.width || actual.height !== expected.height) { pageSizesMatch = false; break; }
    }
    if (!checkPdfHeader(output) || !pagesMatch || !pageSizesMatch) throw new PdfInputError("invalid-pdf", "The rebuilt PDF failed validation and was discarded.");
    return {
      bytes: output,
      report: {
        pagesTotal,
        pagesRecovered,
        droppedPages,
        issues,
        metadataRestored,
        notes,
        annotationsPreserved,
        verified: true,
        inputBytes: bytes.byteLength,
        outputBytes: output.byteLength,
      },
    };
  } catch (error) { output.fill(0); throw error; }
}
