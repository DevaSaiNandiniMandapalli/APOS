import type { PdfAnnotation } from "@/lib/pdf-annotations";
import { exportAnnotatedPdf } from "@/lib/pdf-export";

type Request = { bytes: ArrayBuffer; annotations: PdfAnnotation[] };
type Reply = { ok: boolean; output?: ArrayBuffer; error?: string };
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: Reply, transfer?: Transferable[]): void;
};

scope.onmessage = async ({ data }) => {
  const input = new Uint8Array(data.bytes);
  let result: Uint8Array | null = null;

  try {
    result = await exportAnnotatedPdf(input, data.annotations);
    const output = result.buffer.slice(
      result.byteOffset,
      result.byteOffset + result.byteLength,
    ) as ArrayBuffer;

    scope.postMessage({ ok: true, output }, [output]);
  } catch (error) {
    scope.postMessage({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "The edited PDF could not be created.",
    });
  } finally {
    if (input.byteLength) input.fill(0);
    result?.fill(0);
  }
};
