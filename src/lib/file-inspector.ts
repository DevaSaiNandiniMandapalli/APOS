export const INSPECTOR_LIMITS = {
  perFileBytes: 50 * 1024 * 1024,
} as const;

export type FileFacts = {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  checksum?: string;
  pages?: number;
  width?: number;
  height?: number;
  lines?: number;
  words?: number;
};

export type ReportRow = { label: string; value: string };

const UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  if (bytes === 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[unit]}`;
}

export function formatChecksum(checksum: string): string {
  const value = checksum.trim().toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(value)) return checksum;
  return (value.match(/.{1,8}/g) ?? []).join(" ");
}

export function formatModified(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Unknown";
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Unknown";
  }
}

const EXTENSIONS: Record<string, string> = {
  pdf: "PDF document",
  png: "PNG image",
  jpg: "JPEG image",
  jpeg: "JPEG image",
  gif: "GIF image",
  webp: "WebP image",
  bmp: "BMP image",
  tif: "TIFF image",
  tiff: "TIFF image",
  svg: "SVG vector image",
  txt: "Plain text",
  md: "Markdown document",
  csv: "CSV spreadsheet",
  tsv: "TSV spreadsheet",
  json: "JSON data",
  xml: "XML data",
  html: "HTML document",
  css: "Stylesheet",
  js: "JavaScript source",
  ts: "TypeScript source",
  zip: "ZIP archive",
  docx: "Word document",
  xlsx: "Excel workbook",
  pptx: "PowerPoint presentation",
};

const MIME_TYPES: Record<string, string> = {
  "application/pdf": "PDF document",
  "application/json": "JSON data",
  "application/zip": "ZIP archive",
  "application/xml": "XML data",
  "image/png": "PNG image",
  "image/jpeg": "JPEG image",
  "image/gif": "GIF image",
  "image/webp": "WebP image",
  "image/bmp": "BMP image",
  "image/tiff": "TIFF image",
  "image/svg+xml": "SVG vector image",
  "text/plain": "Plain text",
  "text/csv": "CSV spreadsheet",
  "text/markdown": "Markdown document",
  "text/html": "HTML document",
  "text/css": "Stylesheet",
};

export function describeType(type: string, name: string): string {
  const mime = (type || "").split(";")[0].trim().toLowerCase();
  if (MIME_TYPES[mime]) return MIME_TYPES[mime];
  if (mime.startsWith("image/")) return `${mime.slice(6).toUpperCase()} image`;
  if (mime.startsWith("text/")) return "Text document";
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (extension && EXTENSIONS[extension]) return EXTENSIONS[extension];
  if (extension) return `${extension.toUpperCase()} file`;
  return mime || "Unknown type";
}

export function isTextLike(type: string, name: string): boolean {
  const mime = (type || "").toLowerCase();
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml") return true;
  return /\.(txt|md|csv|tsv|json|xml|html|css|js|ts|log|ya?ml)$/i.test(name);
}

export function countText(bytes: Uint8Array): { lines: number; words: number } {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const text = decoder.decode(bytes);
  if (!text.trim()) return { lines: 0, words: 0 };
  const lines = text.split(/\r\n|\r|\n/).length;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return { lines, words };
}

export function buildReportRows(facts: FileFacts): ReportRow[] {
  const rows: ReportRow[] = [
    { label: "File name", value: facts.name || "Unknown" },
    { label: "File type", value: describeType(facts.type, facts.name) },
    { label: "Size", value: formatBytes(facts.size) },
    { label: "Exact bytes", value: `${Math.max(0, facts.size).toLocaleString()} bytes` },
    { label: "Last modified", value: formatModified(facts.lastModified) },
  ];
  if (facts.pages !== undefined) rows.push({ label: "Pages", value: String(facts.pages) });
  if (facts.width !== undefined && facts.height !== undefined) {
    const ratio = facts.height > 0 ? Math.round((facts.width / facts.height) * 100) / 100 : 0;
    rows.push({ label: "Dimensions", value: `${facts.width} × ${facts.height} px (ratio ${ratio})` });
  }
  if (facts.lines !== undefined && facts.words !== undefined) {
    rows.push({ label: "Text content", value: `${facts.lines.toLocaleString()} lines · ${facts.words.toLocaleString()} words` });
  }
  if (facts.checksum) rows.push({ label: "SHA-256", value: formatChecksum(facts.checksum) });
  return rows;
}

export function reportToText(rows: ReportRow[]): string {
  return rows.map((row) => `${row.label}: ${row.value}`).join("\n");
}
