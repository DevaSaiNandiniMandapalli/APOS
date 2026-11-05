import { repairPdfBuffer } from "@/lib/pdf-repair";
import { optimizePdfBuffer, type OptimizeOptions } from "@/lib/pdf-optimize";
import { PdfInputError } from "@/lib/pdf-limits";

type Request =
  | { mode: "repair"; file: ArrayBuffer }
  | { mode: "optimize"; file: ArrayBuffer; options: OptimizeOptions };

const workerScope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };

workerScope.onmessage = async (event) => {
  let output: Uint8Array | null = null;
  try {
    const input = new Uint8Array(event.data.file);
    const result = event.data.mode === "repair"
      ? await repairPdfBuffer(input)
      : await optimizePdfBuffer(input, event.data.options);
    output = result.bytes;
    const bytes = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    workerScope.postMessage({ ok: true, mode: event.data.mode, bytes, report: result.report }, [bytes]);
  } catch (error) {
    workerScope.postMessage({ ok: false, error: error instanceof PdfInputError ? error.message : "The PDF could not be processed safely. Try a different file." });
  } finally {
    new Uint8Array(event.data.file).fill(0);
    output?.fill(0);
  }
};
