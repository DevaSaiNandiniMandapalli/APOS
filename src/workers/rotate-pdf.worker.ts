import { rotatePdfBuffer } from "@/lib/rotate-pdf";
import type { PageRange } from "@/lib/split-pdf";
import { PdfInputError } from "@/lib/pdf-limits";

type Request = { file: ArrayBuffer; ranges: PageRange[]; angle: 90 | 180 | 270; rotateAll: boolean };
const workerScope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };

workerScope.onmessage = async (event) => {
  let output: Uint8Array | null = null;
  try {
    const result = await rotatePdfBuffer(new Uint8Array(event.data.file), event.data.ranges, event.data.angle, event.data.rotateAll);
    output = result.bytes;
    const bytes = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    workerScope.postMessage({ ok: true, bytes, pageCount: result.pageCount }, [bytes]);
  } catch (error) {
    workerScope.postMessage({ ok: false, error: error instanceof PdfInputError ? error.message : "The PDF could not be rotated safely. Try a different file." });
  } finally {
    new Uint8Array(event.data.file).fill(0);
    output?.fill(0);
  }
};
