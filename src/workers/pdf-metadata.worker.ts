import { inspectPdfMetadata, updatePdfMetadata, type PdfMetadata } from "@/lib/pdf-metadata";

type Request = { action: "inspect" | "update"; bytes: ArrayBuffer; metadata?: PdfMetadata };
const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };
scope.onmessage = async ({ data }) => {
  const bytes = new Uint8Array(data.bytes); let output: Uint8Array | null = null;
  try {
    if (data.action === "inspect") scope.postMessage({ ok: true, ...(await inspectPdfMetadata(bytes)) });
    else {
      output = await updatePdfMetadata(bytes, data.metadata!);
      const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
      scope.postMessage({ ok: true, output: buffer }, [buffer]);
    }
  } catch (error) { scope.postMessage({ ok: false, error: error instanceof Error ? error.message : "PDF metadata could not be read or updated." }); }
  finally { if (bytes.byteLength) bytes.fill(0); output?.fill(0); }
};
