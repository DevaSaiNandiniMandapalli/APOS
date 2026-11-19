import { PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { unzipSync } from "fflate";
import { identifyImageFormat, readImageDimensions } from "./image-format";

export const PASSPORT_LIMITS = {
  perFileBytes: 25 * 1024 * 1024,
  pdfPages: 500,
  sampledPages: 20,
} as const;

export type PassportKind = "pdf" | "docx" | "xlsx" | "pptx" | "image" | "unknown";
export type PassportSeverity = "high" | "medium" | "low" | "info";
export type PassportVerdict = "clean" | "review" | "sensitive";

export type PassportFlag = {
  id: string;
  label: string;
  detail: string;
  severity: PassportSeverity;
  tool?: { label: string; href: string };
};

export type PassportField = { label: string; value: string };
export type PassportSection = { title: string; fields: PassportField[] };

export type PassportReport = {
  fileName: string;
  fileSize: number;
  detectedKind: PassportKind;
  mime: string;
  mimeMatches: boolean;
  sha256: string;
  lastModified: string;
  verdict: PassportVerdict;
  score: number;
  flags: PassportFlag[];
  sections: PassportSection[];
  notes: string[];
  canSanitize: boolean;
  sanitizeNote: string;
};

export type CleanPdfResult = {
  bytes: Uint8Array;
  pageCount: number;
  removed: string[];
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function xmlText(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  return match ? decodeXmlEntities(match[1].replace(/<[^>]+>/g, "")).trim() : "";
}

function pdfDate(value: Date | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return "";
  return value.toISOString().replace(".000Z", "Z");
}

function countMatches(value: string, pattern: RegExp) {
  return (value.match(pattern) ?? []).length;
}

export function detectPassportKind(name: string, bytes: Uint8Array): PassportKind {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 16));
  if (head.includes("%PDF-")) return "pdf";
  if (head.startsWith("PK")) {
    const lower = name.toLowerCase();
    if (lower.endsWith(".docx")) return "docx";
    if (lower.endsWith(".xlsx")) return "xlsx";
    if (lower.endsWith(".pptx")) return "pptx";
    return "unknown";
  }
  if (identifyImageFormat(bytes) !== "unknown") return "image";
  return "unknown";
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return "unavailable in this browser";
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

type PdfStructure = {
  encrypted: boolean;
  parseError: boolean;
  pageCount: number;
  pageSizes: string[];
  metadata: Record<string, string>;
  hasJavaScript: boolean;
  hasEmbeddedFiles: boolean;
  hasAcroForm: boolean;
  hasAnnotations: boolean;
  hasOpenAction: boolean;
  hasExternalLinks: boolean;
  hasLaunchAction: boolean;
  hasRichMedia: boolean;
  hasXfa: boolean;
  hasOptionalContent: boolean;
  hasSignature: boolean;
};

function inspectPdfRaw(bytes: Uint8Array): Omit<PdfStructure, "pageCount" | "pageSizes" | "metadata" | "encrypted" | "parseError"> {
  const raw = new TextDecoder("latin1").decode(bytes);
  return {
    hasJavaScript: /\/(?:JavaScript|JS)\b/.test(raw),
    hasEmbeddedFiles: /\/EmbeddedFiles\b/.test(raw),
    hasAcroForm: /\/AcroForm\b/.test(raw),
    hasAnnotations: /\/Annots\b/.test(raw),
    hasOpenAction: /\/OpenAction\b/.test(raw),
    hasExternalLinks: /\/URI\b/.test(raw),
    hasLaunchAction: /\/Launch\b/.test(raw),
    hasRichMedia: /\/RichMedia\b/.test(raw),
    hasXfa: /\/XFA\b/.test(raw),
    hasOptionalContent: /\/OCProperties\b/.test(raw),
    hasSignature: /\/ByteRange\b/.test(raw),
  };
}

async function inspectPdf(bytes: Uint8Array): Promise<PdfStructure> {
  const raw = inspectPdfRaw(bytes);
  let pdf: PDFDocument | null = null;
  let encrypted = false;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
    encrypted = pdf.isEncrypted;
  } catch {
    return {
      ...raw,
      encrypted: false,
      parseError: true,
      pageCount: 0,
      pageSizes: [],
      metadata: {},
    };
  }

  const pages = (() => {
    try { return pdf.getPages(); } catch { return []; }
  })();
  const pageSizes = pages.slice(0, 20).map((page) => {
    const size = page.getSize();
    const rotation = page.getRotation().angle;
    return `${Math.round(size.width)} x ${Math.round(size.height)} pt${rotation ? `, ${rotation}°` : ""}`;
  });
  let keywords: string | string[] | undefined;
  try { keywords = pdf.getKeywords(); } catch { keywords = []; }
  return {
    ...raw,
    encrypted,
    parseError: false,
    pageCount: pages.length,
    pageSizes,
    metadata: {
      title: pdf.getTitle() ?? "",
      author: pdf.getAuthor() ?? "",
      subject: pdf.getSubject() ?? "",
      keywords: Array.isArray(keywords) ? keywords.join(", ") : String(keywords ?? ""),
      creator: pdf.getCreator() ?? "",
      producer: pdf.getProducer() ?? "",
      created: pdfDate(pdf.getCreationDate()),
      modified: pdfDate(pdf.getModificationDate()),
    },
  };
}

export type PdfTextInspection = {
  sampledPages: number;
  textCharacters: number;
  imagePages: number;
  scannedPages: number[];
};

export async function inspectPdfTextLayer(bytes: Uint8Array): Promise<PdfTextInspection> {
  const pdfjs = await import("pdfjs-dist");
  if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const document = await loading.promise;
  const sampled = Math.min(document.numPages, PASSPORT_LIMITS.sampledPages);
  let textCharacters = 0;
  let imagePages = 0;
  const scannedPages: number[] = [];
  const imageOps = new Set([
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintSolidColorImageMask,
  ]);
  try {
    for (let index = 1; index <= sampled; index += 1) {
      const page = await document.getPage(index);
      try {
        const content = await page.getTextContent();
        const text = content.items.map((item) => "str" in item ? item.str : "").join("").trim();
        textCharacters += text.length;
        const operators = await page.getOperatorList();
        let images = 0;
        for (const fn of operators.fnArray) if (imageOps.has(fn)) images += 1;
        if (images > 0) imagePages += 1;
        if (!text && images > 0) scannedPages.push(index);
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await document.cleanup();
    await loading.destroy();
  }
  return { sampledPages: sampled, textCharacters, imagePages, scannedPages };
}

type PackageInspection = {
  parts: number;
  paragraphs: number;
  sheets: number;
  slides: number;
  mediaFiles: number;
  mediaBytes: number;
  embeddedObjects: number;
  macros: boolean;
  externalLinks: number;
  signatureParts: boolean;
  metadata: Record<string, string>;
  notes: string[];
};

function inspectOfficePackage(bytes: Uint8Array, kind: "docx" | "xlsx" | "pptx"): PackageInspection {
  const notes: string[] = [];
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("This Office file is not a readable ZIP package. It may be encrypted, damaged or password protected.");
  }
  const names = Object.keys(entries);
  let mediaFiles = 0;
  let mediaBytes = 0;
  let embeddedObjects = 0;
  for (const name of names) {
    if (name.startsWith("word/media/") || name.startsWith("xl/media/") || name.startsWith("ppt/media/")) {
      mediaFiles += 1;
      mediaBytes += entries[name].byteLength;
    }
    if (name.includes("/embeddings/")) embeddedObjects += 1;
  }
  const documentXml = kind === "docx" ? entries["word/document.xml"] : kind === "xlsx" ? entries["xl/workbook.xml"] : undefined;
  const slides = names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
  const worksheets = names.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).length;
  let paragraphs = 0;
  if (kind === "docx" && documentXml) {
    paragraphs = countMatches(new TextDecoder().decode(documentXml), /<w:p\b/g);
  }
  const rels = names
    .filter((name) => /_rels\/.*\.rels$/.test(name))
    .map((name) => new TextDecoder().decode(entries[name]))
    .join("\n");
  const externalLinks = countMatches(rels, /TargetMode="External"/g);
  if (externalLinks) notes.push(`${externalLinks} external relationship(s) point outside the package. Review them before sharing.`);
  const core = entries["docProps/core.xml"] ? new TextDecoder().decode(entries["docProps/core.xml"]) : "";
  const app = entries["docProps/app.xml"] ? new TextDecoder().decode(entries["docProps/app.xml"]) : "";
  return {
    parts: names.length,
    paragraphs,
    sheets: worksheets,
    slides,
    mediaFiles,
    mediaBytes,
    embeddedObjects,
    macros: names.some((name) => /vbaProject\.bin$/i.test(name)),
    externalLinks,
    signatureParts: names.some((name) => name.startsWith("_xmlsignatures/")),
    metadata: {
      title: xmlText(core, "dc:title"),
      author: xmlText(core, "dc:creator"),
      subject: xmlText(core, "dc:subject"),
      keywords: xmlText(core, "cp:keywords"),
      creator: xmlText(app, "Application"),
      producer: xmlText(app, "AppVersion"),
      created: xmlText(core, "dcterms:created"),
      modified: xmlText(core, "dcterms:modified"),
      lastModifiedBy: xmlText(core, "cp:lastModifiedBy"),
    },
    notes,
  };
}

function severityWeight(severity: PassportSeverity): number {
  return severity === "high" ? 25 : severity === "medium" ? 10 : severity === "low" ? 4 : 0;
}

function verdictFor(score: number, flags: PassportFlag[]): PassportVerdict {
  if (flags.some((flag) => flag.severity === "high") || score < 60) return "sensitive";
  if (flags.some((flag) => flag.severity === "medium") || score < 85) return "review";
  return "clean";
}

function buildFlag(id: string, label: string, detail: string, severity: PassportSeverity, href?: string): PassportFlag {
  return { id, label, detail, severity, ...(href ? { tool: { label: "Open the relevant tool", href } } : {}) };
}

export async function buildDocumentPassport(
  file: File,
  options: { deep?: boolean } = {},
): Promise<PassportReport> {
  if (!file.size) throw new Error("That file is empty, so there is nothing to inspect.");
  if (file.size > PASSPORT_LIMITS.perFileBytes) throw new Error(`Choose a file under ${formatBytes(PASSPORT_LIMITS.perFileBytes)}.`);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detectedKind = detectPassportKind(file.name, bytes);
  const mime = file.type || "unknown";
  const expectedMime: Record<PassportKind, string[]> = {
    pdf: ["application/pdf"],
    docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    image: ["image/png", "image/jpeg", "image/webp", "image/tiff"],
    unknown: [],
  };
  const mimeMatches = !mime || mime === "application/octet-stream" || expectedMime[detectedKind].includes(mime);
  const scoreParts: number[] = [];
  const flags: PassportFlag[] = [];
  const sections: PassportSection[] = [];
  const notes: string[] = [];
  let canSanitize = false;

  const addFlag = (flag: PassportFlag) => {
    flags.push(flag);
    scoreParts.push(severityWeight(flag.severity));
  };
  const addSection = (title: string, fields: PassportField[]) => {
    const usable = fields.filter((field) => field.value);
    if (usable.length) sections.push({ title, fields: usable });
  };

  const sha256 = await sha256Hex(bytes);

  addSection("Identity", [
    { label: "File name", value: file.name },
    { label: "Size", value: formatBytes(file.size) },
    { label: "Detected type", value: detectedKind === "unknown" ? "Unrecognised" : detectedKind.toUpperCase() },
    { label: "Stated MIME type", value: mime },
    { label: "SHA-256", value: sha256 },
    { label: "Last modified", value: new Date(file.lastModified).toISOString() },
  ]);

  if (!mimeMatches) {
    addFlag(buildFlag("mime-mismatch", "Type mismatch", `The file is detected as ${detectedKind.toUpperCase()}, but its MIME type says ${mime || "nothing"}. Treat the contents with extra care.`, "medium"));
  }

  if (detectedKind === "pdf") {
    const pdf = await inspectPdf(bytes);
    if (pdf.parseError) addFlag(buildFlag("unreadable", "PDF could not be parsed", "The PDF structure could not be opened. It may be corrupt, encrypted with an unsupported method, or not a real PDF. Do not rely on this report until the file is repaired.", "high", "/tools/repair-pdf"));
    if (pdf.encrypted) addFlag(buildFlag("encrypted", "Password protection", "This PDF is encrypted. Metadata and some structure may be hidden until it is unlocked.", "medium", "/tools/unlock-pdf"));
    if (pdf.hasJavaScript) addFlag(buildFlag("javascript", "Embedded JavaScript", "The PDF contains JavaScript actions. Do not open it in a viewer that executes scripts unless you trust the source.", "high", "/tools/optimize-pdf"));
    if (pdf.hasEmbeddedFiles) addFlag(buildFlag("embedded-files", "Embedded files", "The PDF carries attached files. They travel with the document and can contain anything.", "high"));
    if (pdf.hasAcroForm) addFlag(buildFlag("forms", "Fillable form", "The PDF contains form fields. Filled values and field names can leak personal or business data.", "medium", "/tools/optimize-pdf"));
    if (pdf.hasAnnotations) addFlag(buildFlag("annotations", "Annotations or comments", "Annotations can contain reviewer names, notes, highlights and hidden comments.", "medium", "/tools/edit-pdf"));
    if (pdf.hasOpenAction || pdf.hasLaunchAction) addFlag(buildFlag("actions", "Automatic actions", "The PDF contains an OpenAction or Launch action that may run when the file is opened.", "high", "/tools/optimize-pdf"));
    if (pdf.hasExternalLinks) addFlag(buildFlag("external-links", "External links", "The PDF contains URI actions. Review outbound links before publishing or forwarding.", "low"));
    if (pdf.hasRichMedia) addFlag(buildFlag("rich-media", "Embedded rich media", "The PDF contains rich media or multimedia objects that may not render consistently.", "medium"));
    if (pdf.hasXfa) addFlag(buildFlag("xfa", "XFA form data", "The PDF uses XFA forms, which can embed data outside the standard AcroForm fields.", "medium"));
    if (pdf.hasOptionalContent) addFlag(buildFlag("optional-content", "Optional layers", "The PDF has optional content groups (layers). Some content may be hidden in the default view.", "medium"));
    if (pdf.hasSignature) notes.push("A digital signature marker is present. Re-saving a signed PDF can invalidate its signature.");
    const metadataPresent = Object.entries(pdf.metadata).some(([key, value]) => !["created", "modified"].includes(key) && value.trim());
    if (metadataPresent) addFlag(buildFlag("metadata", "Document metadata", "Title, author, creator, producer or keywords are present. They can identify a person or an organisation.", "low", "/tools/pdf-metadata"));

    addSection("Document", [
      { label: "Pages", value: String(pdf.pageCount) },
      { label: "Page sizes", value: [...new Set(pdf.pageSizes)].join("; ") },
      { label: "Encryption", value: pdf.encrypted ? "Encrypted" : "None detected" },
      { label: "Embedded JavaScript", value: pdf.hasJavaScript ? "Present" : "None detected" },
      { label: "Attachments", value: pdf.hasEmbeddedFiles ? "Present" : "None detected" },
      { label: "Form fields", value: pdf.hasAcroForm ? "Present" : "None detected" },
      { label: "Annotations", value: pdf.hasAnnotations ? "Present" : "None detected" },
      { label: "Optional layers", value: pdf.hasOptionalContent ? "Present" : "None detected" },
    ]);
    addSection("Metadata", Object.entries(pdf.metadata).map(([key, value]) => ({ label: key.charAt(0).toUpperCase() + key.slice(1), value })));

    if (options.deep) {
      try {
        const text = await inspectPdfTextLayer(bytes);
        addSection("Text layer", [
          { label: "Pages sampled", value: String(text.sampledPages) },
          { label: "Characters found", value: String(text.textCharacters) },
          { label: "Pages with images", value: String(text.imagePages) },
          { label: "Likely scanned pages", value: text.scannedPages.length ? text.scannedPages.join(", ") : "None detected" },
        ]);
        if (text.textCharacters === 0 && pdf.pageCount > 0) {
          addFlag(buildFlag("no-text-layer", "No selectable text", "The sampled pages contain no text layer. This is likely a scan; OCR is needed before search, copy or text-based redaction.", "medium", "/tools/ocr-pdf"));
        } else if (text.scannedPages.length) {
          addFlag(buildFlag("some-scanned-pages", "Some pages are scans", `${text.scannedPages.length} sampled page(s) have images but no text layer. OCR those pages if they need to be searchable.`, "low", "/tools/ocr-pdf"));
        }
      } catch {
        notes.push("The text layer could not be inspected. The file may be encrypted, damaged or use features this browser cannot read.");
      }
    }
    canSanitize = !pdf.encrypted && pdf.pageCount > 0 && pdf.pageCount <= PASSPORT_LIMITS.pdfPages;
  } else if (detectedKind === "docx" || detectedKind === "xlsx" || detectedKind === "pptx") {
    const pkg = inspectOfficePackage(bytes, detectedKind);
    if (pkg.macros) addFlag(buildFlag("macros", "VBA macros", "The package contains VBA macros. They can run code when opened in Office. Only open trusted files and keep macro security enabled.", "high"));
    if (pkg.externalLinks) addFlag(buildFlag("external-links", "External relationships", `${pkg.externalLinks} relationship(s) point outside the package. They may load remote content or leak that the file was opened.`, "medium"));
    if (pkg.embeddedObjects) addFlag(buildFlag("embedded-objects", "Embedded objects", `${pkg.embeddedObjects} embedded object(s) travel inside the package and may contain additional data.`, "high"));
    if (pkg.metadata.title || pkg.metadata.author || pkg.metadata.lastModifiedBy || pkg.metadata.creator) {
      addFlag(buildFlag("metadata", "Document metadata", "Author, title, application or last-modified-by fields are present. They can identify a person or device.", "low"));
    }
    addSection("Package", [
      { label: "Detected type", value: detectedKind.toUpperCase() },
      { label: "Package parts", value: String(pkg.parts) },
      { label: "Paragraphs", value: pkg.paragraphs ? String(pkg.paragraphs) : "" },
      { label: "Worksheets", value: pkg.sheets ? String(pkg.sheets) : "" },
      { label: "Slides", value: pkg.slides ? String(pkg.slides) : "" },
      { label: "Media files", value: pkg.mediaFiles ? `${pkg.mediaFiles} (${formatBytes(pkg.mediaBytes)})` : "" },
      { label: "Embedded objects", value: pkg.embeddedObjects ? String(pkg.embeddedObjects) : "None detected" },
      { label: "VBA macros", value: pkg.macros ? "Present" : "None detected" },
      { label: "External relationships", value: pkg.externalLinks ? String(pkg.externalLinks) : "None detected" },
      { label: "Package signatures", value: pkg.signatureParts ? "Present" : "None detected" },
    ]);
    addSection("Metadata", Object.entries(pkg.metadata).map(([key, value]) => ({ label: key.charAt(0).toUpperCase() + key.slice(1), value })));
    notes.push(...pkg.notes);
    notes.push("This browser can inspect the Office package but cannot safely strip macros, embedded objects or external relationships. Re-save it in Office with those features removed before sharing.");
  } else if (detectedKind === "image") {
    const format = identifyImageFormat(bytes);
    let dimensions = "";
    try {
      const size = readImageDimensions(bytes, format);
      dimensions = `${size.width} x ${size.height}px`;
    } catch { /* header-only dimensions unavailable */ }
    const raw = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.byteLength, 256 * 1024)));
    if (/Exif\0\0/i.test(raw)) addFlag(buildFlag("exif", "EXIF metadata", "The image contains EXIF data. It can include camera model, timestamps and GPS coordinates.", "medium", "/tools/image-converter"));
    addSection("Image", [
      { label: "Format", value: String(format).toUpperCase() },
      { label: "Dimensions", value: dimensions },
      { label: "EXIF", value: /Exif\0\0/i.test(raw) ? "Present" : "None detected in the sampled header" },
    ]);
    notes.push("To remove image metadata, re-encode the image with the Image converter; re-encoding is lossy for JPEG.");
  } else {
    notes.push("The file signature does not match a supported PDF, Office or image format. It was not opened.");
    addFlag(buildFlag("unknown", "Unrecognised file", "The file signature does not match a supported document format. Do not open it based on its extension alone.", "medium"));
  }

  const penalty = scoreParts.reduce((sum, value) => sum + value, 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  return {
    fileName: file.name,
    fileSize: file.size,
    detectedKind,
    mime,
    mimeMatches,
    sha256,
    lastModified: new Date(file.lastModified).toISOString(),
    verdict: verdictFor(score, flags),
    score,
    flags,
    sections,
    notes,
    canSanitize,
    sanitizeNote: canSanitize
      ? "Create a clean PDF copy with document metadata, annotations, form widgets, links, attachments, JavaScript, bookmarks and tag structure removed. Text and page appearance are kept. Review the result before sharing."
      : detectedKind === "pdf"
        ? "A clean copy is unavailable for encrypted or oversized PDFs. Unlock it first, or use PDF metadata/optimize for targeted cleanup."
        : "Automatic cleaning is available for PDFs only. Office packages must be re-saved in Office with macros, embedded objects and external links removed.",
  };
}

export async function createCleanPdf(file: File): Promise<CleanPdfResult> {
  if (!file.size) throw new Error("Choose a PDF to clean.");
  if (file.size > PASSPORT_LIMITS.perFileBytes) throw new Error(`Choose a PDF under ${formatBytes(PASSPORT_LIMITS.perFileBytes)}.`);
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  if (detectPassportKind(file.name, sourceBytes) !== "pdf") throw new Error("A clean copy is available for PDF files only.");
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  } catch {
    throw new Error("This PDF could not be opened. It may be encrypted, damaged or unsupported.");
  }
  if (source.isEncrypted) throw new Error("Unlock this PDF before creating a clean copy.");
  const pageCount = source.getPageCount();
  if (pageCount < 1 || pageCount > PASSPORT_LIMITS.pdfPages) throw new Error(`The PDF must contain 1-${PASSPORT_LIMITS.pdfPages} pages.`);
  const sizes = source.getPages().map((page) => page.getSize());
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, source.getPageIndices());
  for (const page of pages) {
    page.node.delete(PDFName.of("Annots"));
    page.node.delete(PDFName.of("AA"));
    output.addPage(page);
  }
  output.setTitle("");
  output.setAuthor("");
  output.setSubject("");
  output.setKeywords([]);
  output.setCreator("");
  output.setProducer("");
  const bytes = new Uint8Array(await output.save({ useObjectStreams: true }));
  const verified = await PDFDocument.load(bytes, { updateMetadata: false });
  if (verified.getPageCount() !== pageCount) throw new Error("The clean copy failed its page-count check and was discarded.");
  const verifiedSizes = verified.getPages().map((page) => page.getSize());
  if (verifiedSizes.some((size, index) => size.width !== sizes[index].width || size.height !== sizes[index].height)) {
    throw new Error("The clean copy failed its page-size check and was discarded.");
  }
  return {
    bytes,
    pageCount,
    removed: ["document metadata", "annotations and comments", "form widgets", "links", "JavaScript actions", "attachments", "bookmarks and tag structure"],
  };
}
