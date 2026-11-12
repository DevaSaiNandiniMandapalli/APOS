import { mergePdfBuffers, type MergeProgress } from "@/lib/merge-pdf";
import { PdfInputError } from "@/lib/pdf-limits";

type Reply =
  | { type: "progress"; progress: MergeProgress }
  | { type: "result"; ok: boolean; bytes?: ArrayBuffer; pageCount?: number; error?: string };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ files: ArrayBuffer[] }>) => void) | null;
  postMessage(message: Reply, transfer?: Transferable[]): void;
};

workerScope.onmessage = async (event: MessageEvent<{ files: ArrayBuffer[] }>) => {
  try {
    const result = await mergePdfBuffers(
      event.data.files.map((buffer) => new Uint8Array(buffer)),
      (progress) => workerScope.postMessage({ type: "progress", progress }),
    );
    const bytes = result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength) as ArrayBuffer;
    workerScope.postMessage({ type: "result", ok: true, bytes, pageCount: result.pageCount }, [bytes]);
  } catch (error) {
    const message = error instanceof PdfInputError ? error.message : "A PDF could not be processed safely. Try a different file.";
    workerScope.postMessage({ type: "result", ok: false, error: message });
  }
};
