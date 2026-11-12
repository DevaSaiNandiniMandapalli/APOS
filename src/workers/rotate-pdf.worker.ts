import { rotatePdfPages, type RotateProgress } from "@/lib/rotate-pdf";
import { PdfInputError } from "@/lib/pdf-limits";

type Request = { file: ArrayBuffer; rotations: Record<number, number> };
type Reply =
  | { type: "progress"; progress: RotateProgress }
  | { type: "result"; ok: boolean; bytes?: ArrayBuffer; pageCount?: number; error?: string };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: Reply, transfer?: Transferable[]): void;
};

workerScope.onmessage = async (event) => {
  let output: Uint8Array | null = null;
  try {
    const result = await rotatePdfPages(
      new Uint8Array(event.data.file),
      event.data.rotations,
      (progress) => workerScope.postMessage({ type: "progress", progress }),
    );
    output = result.bytes;
    const bytes = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    workerScope.postMessage({ type: "result", ok: true, bytes, pageCount: result.pageCount }, [bytes]);
  } catch (error) {
    workerScope.postMessage({ type: "result", ok: false, error: error instanceof PdfInputError ? error.message : "The PDF could not be rotated safely. Try a different file." });
  } finally {
    new Uint8Array(event.data.file).fill(0);
    output?.fill(0);
  }
};
