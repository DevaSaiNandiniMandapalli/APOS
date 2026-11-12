import { extractPdfPages, splitPdfBuffer, type PageRange, type SplitProgress } from "@/lib/split-pdf";
import { PdfInputError } from "@/lib/pdf-limits";

type Request =
  | { mode: "extract"; file: ArrayBuffer; pages: number[] }
  | { mode: "ranges"; file: ArrayBuffer; ranges: PageRange[] };
type Reply =
  | { type: "progress"; progress: SplitProgress }
  | { type: "result"; ok: boolean; files?: ArrayBuffer[]; pageCount?: number; error?: string };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: Reply, transfer?: Transferable[]): void;
};

workerScope.onmessage = async (event) => {
  let outputs: Uint8Array[] = [];
  try {
    const input = new Uint8Array(event.data.file);
    if (event.data.mode === "extract") {
      const result = await extractPdfPages(input, event.data.pages, (progress) => workerScope.postMessage({ type: "progress", progress }));
      outputs = [result.bytes];
      const files = [result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength) as ArrayBuffer];
      workerScope.postMessage({ type: "result", ok: true, files, pageCount: result.pageCount }, files);
    } else {
      outputs = await splitPdfBuffer(input, event.data.ranges, (progress) => workerScope.postMessage({ type: "progress", progress }));
      const files = outputs.map((output) => output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer);
      workerScope.postMessage({ type: "result", ok: true, files }, files);
    }
  } catch (error) {
    workerScope.postMessage({ type: "result", ok: false, error: error instanceof PdfInputError ? error.message : "The PDF could not be split safely. Try a different file." });
  } finally {
    new Uint8Array(event.data.file).fill(0);
    outputs.forEach((output) => output.fill(0));
  }
};
