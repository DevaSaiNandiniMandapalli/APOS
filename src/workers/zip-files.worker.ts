import { zipSync } from "fflate";

type ZipInput = { files: Array<{ name: string; bytes: ArrayBuffer }> };
const workerScope = self as unknown as { onmessage: ((event: MessageEvent<ZipInput>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };

workerScope.onmessage = (event) => {
  const inputs = event.data.files;
  let output: Uint8Array | null = null;
  try {
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 20) throw new Error("Invalid archive file count.");
    const entries: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
    const names = new Set<string>();
    let totalBytes = 0;
    for (const item of inputs) {
      if (!item.name || item.name.includes("/") || item.name.includes("\\") || item.name === "." || item.name === "..") throw new Error("Unsafe archive entry name.");
      if (names.has(item.name.toLocaleLowerCase())) throw new Error("Duplicate archive entry name.");
      names.add(item.name.toLocaleLowerCase());
      totalBytes += item.bytes.byteLength;
      if (totalBytes > 100 * 1024 * 1024) throw new Error("Archive inputs exceed the 100 MB limit.");
      entries[item.name] = new Uint8Array(item.bytes);
    }
    output = zipSync(entries, { level: 0 });
    if (output.length < 22 || output[0] !== 0x50 || output[1] !== 0x4b) throw new Error("Archive output validation failed.");
    const bytes = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    workerScope.postMessage({ ok: true, bytes }, [bytes]);
  } catch {
    workerScope.postMessage({ ok: false, error: "The ZIP archive could not be created or validated." });
  } finally {
    inputs?.forEach((item) => { if (item.bytes.byteLength) new Uint8Array(item.bytes).fill(0); });
    output?.fill(0);
  }
};
