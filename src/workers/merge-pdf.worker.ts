import { mergePdfBuffers } from "@/lib/merge-pdf";
import { PdfInputError } from "@/lib/pdf-limits";

(self as unknown as { onmessage: (event: MessageEvent<{ files: ArrayBuffer[] }>) => void; postMessage: (message: unknown, transfer?: Transferable[]) => void }).onmessage = async (event: MessageEvent<{ files: ArrayBuffer[] }>) => {
  try {
    const result = await mergePdfBuffers(event.data.files.map((buffer) => new Uint8Array(buffer)));
    const bytes = result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength) as ArrayBuffer;
    (self as unknown as { postMessage: (message: unknown, transfer?: Transferable[]) => void }).postMessage({ ok: true, bytes, pageCount: result.pageCount }, [bytes]);
  } catch (error) {
    const message = error instanceof PdfInputError ? error.message : "A PDF could not be processed safely. Try a different file.";
    (self as unknown as { postMessage: (message: unknown, transfer?: Transferable[]) => void }).postMessage({ ok: false, error: message });
  }
};
