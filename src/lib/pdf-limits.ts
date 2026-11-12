export const PDF_LIMITS = {
  fileCount: 10,
  perFileBytes: 50 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
  pages: 500,
  splitOutputs: 500,
  splitTotalBytes: 100 * 1024 * 1024,
  mergeOutputBytes: 100 * 1024 * 1024,
  rotateOutputBytes: 50 * 1024 * 1024,
} as const;

export type PdfInputErrorCode = "empty" | "too-few" | "too-many" | "too-large" | "wrong-signature" | "invalid-pdf" | "too-many-pages" | "invalid-pages" | "too-many-outputs";

export class PdfInputError extends Error {
  constructor(public readonly code: PdfInputErrorCode, message: string) { super(message); this.name = "PdfInputError"; }
}

export function checkPdfHeader(bytes: Uint8Array) {
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return header.includes("%PDF-");
}
