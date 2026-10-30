import { markPdf, type MarkOptions } from "@/lib/pdf-marking";

type Request = { bytes: ArrayBuffer; options: Omit<MarkOptions, "image"> & { image?: { bytes: ArrayBuffer; format: "png" | "jpeg" } } };
const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };

scope.onmessage = async ({ data }) => {
  const input = new Uint8Array(data.bytes); let image: Uint8Array | undefined; let result: Uint8Array | null = null;
  try {
    if (data.options.image) image = new Uint8Array(data.options.image.bytes);
    result = await markPdf(input, { ...data.options, image: image ? { bytes: image, format: data.options.image!.format } : undefined });
    const output = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) as ArrayBuffer;
    scope.postMessage({ ok: true, output }, [output]);
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : "The PDF could not be updated." });
  } finally {
    if (input.byteLength) input.fill(0);
    if (image?.byteLength) image.fill(0);
    result?.fill(0);
  }
};
