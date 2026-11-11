import type { PDFDocumentProxy } from "pdfjs-dist";

/** Renders PDF pages that actually contain pictures back to PNG data URIs. */
export async function renderPdfPicturePages(
  file: File,
  options: { scale?: number; signal?: AbortSignal; onProgress?: (page: number, total: number) => void } = {},
): Promise<{ totalPages: number; pages: { page: number; dataUrl: string; width: number; height: number }[] }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const buffer = await file.arrayBuffer();
  const loading = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc: PDFDocumentProxy = await loading.promise;
  const pages: { page: number; dataUrl: string; width: number; height: number }[] = [];
  const scale = options.scale ?? 1.5;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  try {
    for (let index = 1; index <= doc.numPages; index += 1) {
      if (options.signal?.aborted) throw new DOMException("Conversion cancelled", "AbortError");
      const page = await doc.getPage(index);
      const operators = await page.getOperatorList();
      const hasPicture = operators.fnArray.some((fn) => fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject);
      if (hasPicture && context) {
        const viewport = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        pages.push({ page: index, dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height });
      }
      options.onProgress?.(index, doc.numPages);
    }
  } finally {
    await doc.cleanup();
    await loading.destroy();
  }
  return { totalPages: doc.numPages, pages };
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
