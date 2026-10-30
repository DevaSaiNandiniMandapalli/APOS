import { zipSync } from "fflate";

type ZipInput = { files: Array<{ name: string; bytes: ArrayBuffer }> };
const workerScope = self as unknown as { onmessage: ((event: MessageEvent<ZipInput>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };

workerScope.onmessage = (event) => {
  const inputs = event.data.files;
  let output: Uint8Array | null = null;
  try {
    const entries: Record<string, Uint8Array> = {};
    for (const item of inputs) {
      if (item.name.includes("/") || item.name.includes("\\") || item.name === "..") throw new Error("Unsafe archive entry name.");
      entries[item.name] = new Uint8Array(item.bytes);
    }
    output = zipSync(entries, { level: 0 });
    const bytes = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    workerScope.postMessage({ ok: true, bytes }, [bytes]);
  } catch {
    workerScope.postMessage({ ok: false, error: "The ZIP archive could not be created." });
  } finally {
    inputs.forEach((item) => new Uint8Array(item.bytes).fill(0));
    output?.fill(0);
  }
};
