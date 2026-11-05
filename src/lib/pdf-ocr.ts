export const OCR_PDF_LIMITS = {
  maxPagesPerRun: 20,
  maxFileBytes: 25 * 1024 * 1024,
  defaultScale: 2,
} as const;

export function parsePageSelection(input: string, totalPages: number): number[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return Array.from({ length: Math.min(totalPages, OCR_PDF_LIMITS.maxPagesPerRun) }, (_, index) => index + 1);
  }
  const pages = new Set<number>();
  for (const part of trimmed.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(piece);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < 1 || end < start) throw new Error(`Invalid page range "${piece}".`);
      for (let page = start; page <= Math.min(end, totalPages); page += 1) pages.add(page);
      continue;
    }
    if (!/^\d+$/.test(piece)) throw new Error(`"${piece}" is not a page number or range.`);
    const page = Number(piece);
    if (page < 1 || page > totalPages) throw new Error(`Page ${page} is outside this document (1–${totalPages}).`);
    pages.add(page);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  if (!sorted.length) throw new Error("Choose at least one page.");
  if (sorted.length > OCR_PDF_LIMITS.maxPagesPerRun) {
    throw new Error(`OCR runs on at most ${OCR_PDF_LIMITS.maxPagesPerRun} pages at a time.`);
  }
  return sorted;
}

export function formatOcrPages(pages: { page: number; text: string }[]): string {
  return pages
    .map(({ page, text }) => {
      const body = text.trim();
      return body ? `--- Page ${page} ---\n${body}` : `--- Page ${page} ---\n(no text recognised)`;
    })
    .join("\n\n");
}

export function mergeOcrLines(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
