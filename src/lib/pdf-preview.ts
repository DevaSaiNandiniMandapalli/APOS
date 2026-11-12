import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist";

export type PdfPageRender = {
  dataUrl: string;
  /** Pixel dimensions of the rendered bitmap. */
  width: number;
  /** Pixel dimensions of the rendered bitmap. */
  height: number;
  /** Page width in PDF points after the page rotation is applied. */
  pageWidth: number;
  /** Page height in PDF points after the page rotation is applied. */
  pageHeight: number;
  /** The page's existing /Rotate value. */
  rotation: number;
};

type PdfJsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJsModule> | null = null;

async function getPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/**
 * A PDF.js document kept alive for previews. Rendering is serialised because
 * PDF.js pages share a canvas-oriented worker and previews are intentionally
 * small. Always call `destroy()` when the file changes or the tool unmounts.
 */
export class PdfPreviewDocument {
  private queue: Promise<unknown> = Promise.resolve();
  private destroyed = false;

  constructor(
    private readonly loadingTask: PDFDocumentLoadingTask,
    private readonly document: PDFDocumentProxy,
  ) {}

  get pageCount() {
    return this.document.numPages;
  }

  async renderPage(
    pageNumber: number,
    maxWidth = 180,
    format: "png" | "jpeg" = "jpeg",
  ): Promise<PdfPageRender> {
    if (this.destroyed) throw new Error("This PDF preview has been closed.");
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > this.document.numPages) {
      throw new Error("That page is outside this PDF.");
    }
    const run = this.queue.then(() => this.renderPageNow(pageNumber, maxWidth, format));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async renderPageNow(
    pageNumber: number,
    maxWidth: number,
    format: "png" | "jpeg",
  ): Promise<PdfPageRender> {
    if (this.destroyed) throw new Error("This PDF preview has been closed.");
    const page: PDFPageProxy = await this.document.getPage(pageNumber);
    try {
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.max(0.1, Math.min(2, maxWidth / Math.max(1, baseViewport.width)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("This browser could not create a preview canvas.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const dataUrl = canvas.toDataURL(format === "png" ? "image/png" : "image/jpeg", format === "jpeg" ? 0.86 : undefined);
      return {
        dataUrl,
        width: canvas.width,
        height: canvas.height,
        pageWidth: baseViewport.width,
        pageHeight: baseViewport.height,
        rotation: baseViewport.rotation,
      };
    } finally {
      page.cleanup();
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      await this.document.cleanup();
    } catch {
      // The document may already have been torn down by PDF.js.
    }
    try {
      await this.loadingTask.destroy();
    } catch {
      // A cancelled loading task can already be destroyed.
    }
  }
}

export async function loadPdfPreview(file: File): Promise<PdfPreviewDocument> {
  const pdfjs = await getPdfJs();
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  try {
    const document = await loadingTask.promise;
    return new PdfPreviewDocument(loadingTask, document);
  } catch (error) {
    try {
      await loadingTask.destroy();
    } catch {
      // Ignore cleanup failures for an unreadable document.
    }
    throw error;
  }
}

export async function inspectPdfFile(file: File): Promise<{ pageCount: number; thumbnail: string }> {
  const document = await loadPdfPreview(file);
  try {
    const page = await document.renderPage(1, 168, "jpeg");
    return { pageCount: document.pageCount, thumbnail: page.dataUrl };
  } finally {
    await document.destroy();
  }
}

export function describePdfPreviewError(error: unknown): string {
  if (error instanceof Error && /password|encrypted/i.test(error.message)) {
    return "This PDF is encrypted or password protected. Unlock it before previewing it here.";
  }
  return "This PDF could not be opened for preview. It may be corrupt, encrypted, or unsupported.";
}
