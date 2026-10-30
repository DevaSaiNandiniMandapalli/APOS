import { protectPdf } from "@/lib/pdf-security";

type Request = { bytes: ArrayBuffer; userPassword: string; ownerPassword: string };
const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };
scope.onmessage = async ({ data }) => {
  const input = new Uint8Array(data.bytes); let output: Uint8Array | null = null;
  try {
    output = await protectPdf(input, data.userPassword, data.ownerPassword);
    const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    scope.postMessage({ ok: true, output: buffer }, [buffer]);
  } catch (error) { scope.postMessage({ ok: false, error: error instanceof Error ? error.message : "The PDF security operation failed." }); }
  finally { if (input.byteLength) input.fill(0); output?.fill(0); }
};
