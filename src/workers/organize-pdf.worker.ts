import { PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS, PdfInputError } from "@/lib/pdf-limits";
import { organizePdfBuffer, type OrganizeOptions } from "@/lib/organize-pdf";

type Request = { action: "inspect"; file: ArrayBuffer } | { action: "organize"; file: ArrayBuffer; options: OrganizeOptions };
const workerScope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };

workerScope.onmessage = async (event) => {
  let output: Uint8Array | null = null;
  try {
    if (event.data.action === "inspect") {
      const bytes = new Uint8Array(event.data.file);
      if (bytes.byteLength === 0) throw new PdfInputError("empty", "The selected file is empty.");
      if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new PdfInputError("too-large", "The PDF exceeds the 50 MB file limit.");
      if (!checkPdfHeader(bytes)) throw new PdfInputError("wrong-signature", "This file does not have a PDF signature.");
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      const pageCount = pdf.getPageCount();
      if (pageCount < 1 || pageCount > PDF_LIMITS.pages) throw new PdfInputError("too-many-pages", `The document must contain 1-${PDF_LIMITS.pages} pages.`);
      workerScope.postMessage({ action: "inspect-result", ok: true, pageCount });
    } else {
      const result = await organizePdfBuffer(new Uint8Array(event.data.file), event.data.options);
      output = result.bytes;
      const bytes = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
      workerScope.postMessage({ action: "organize-result", ok: true, bytes, pageCount: result.pageCount }, [bytes]);
    }
  } catch (error) {
    workerScope.postMessage({ action: `${event.data.action}-result`, ok: false, error: error instanceof PdfInputError ? error.message : "The PDF could not be processed safely. It may be corrupt or unsupported." });
  } finally {
    new Uint8Array(event.data.file).fill(0);
    output?.fill(0);
  }
};
