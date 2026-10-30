import { splitPdfBuffer, type PageRange } from "@/lib/split-pdf";
import { PdfInputError } from "@/lib/pdf-limits";

const workerScope = self as unknown as { onmessage: ((event: MessageEvent<{ file: ArrayBuffer; ranges: PageRange[] }>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };

workerScope.onmessage = async (event) => {
  let outputs: Uint8Array[] = [];
  try {
    outputs = await splitPdfBuffer(new Uint8Array(event.data.file), event.data.ranges);
    const files = outputs.map((output) => output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer);
    workerScope.postMessage({ ok: true, files }, files);
  } catch (error) {
    workerScope.postMessage({ ok: false, error: error instanceof PdfInputError ? error.message : "The PDF could not be split safely. Try a different file." });
  } finally {
    new Uint8Array(event.data.file).fill(0);
    outputs.forEach((output) => output.fill(0));
  }
};
