/** Build a safe output name for an annotated PDF download. */
export function annotatedPdfFileName(sourceName: string): string {
  const trimmed = sourceName.trim() || "document.pdf";
  const stem = trimmed
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim();

  return `${stem || "document"}-annotated.pdf`;
}
