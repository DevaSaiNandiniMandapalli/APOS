import { parsePageRanges, pagesToRanges, type PageRange } from "./split-pdf";

/** Resolves "all", an empty value, or a range expression into page numbers in entered order. */
export function resolvePageSelection(value: string | undefined | null, pageCount: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error("The PDF has no pages to process.");
  const trimmed = (value ?? "").trim();
  if (!trimmed || /^all$/i.test(trimmed)) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const ranges: PageRange[] = parsePageRanges(trimmed, pageCount);
  return ranges.flatMap(({ first, last }) =>
    Array.from({ length: last - first + 1 }, (_, offset) => first + offset),
  );
}

export function formatSelectedPages(pages: Iterable<number>): string {
  const list = [...pages];
  if (!list.length) return "";
  return pagesToRanges(list).map(({ first, last }) => first === last ? String(first) : `${first}-${last}`).join(", ");
}

export function describePageSelection(pages: readonly number[], pageCount: number) {
  if (pages.length === pageCount) return `All ${pageCount} page${pageCount === 1 ? "" : "s"}`;
  if (pages.length <= 6) return `Pages ${pages.join(", ")}`;
  return `${pages.length} of ${pageCount} pages`;
}
