import { compressPdfBuffer } from "@/lib/compress-pdf";
import { PdfInputError } from "@/lib/pdf-limits";

const workerScope = self as unknown as { onmessage: ((event: MessageEvent<{ file: ArrayBuffer }>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };

workerScope.onmessage = async (event) => {
  let output: Uint8Array | null = null;
  try {
    const result = await compressPdfBuffer(new Uint8Array(event.data.file));
    output = result.bytes;
    const bytes = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    workerScope.postMessage({ ok: true, bytes, inputBytes: result.inputBytes, outputBytes: result.outputBytes, pageCount: result.pageCount }, [bytes]);
  } catch (error) {
    workerScope.postMessage({ ok: false, error: error instanceof PdfInputError ? error.message : "The PDF could not be rewritten safely. Try a different file." });
  } finally {
    new Uint8Array(event.data.file).fill(0);
    output?.fill(0);
  }
};
