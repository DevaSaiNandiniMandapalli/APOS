"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONVERSION_LIMITS,
  findConversionCapability,
  formatBytes,
  identifyInputFormat,
  runBoundedQueue,
  safeOutputFilename,
  validateConversionInput,
  validateConversionOutput,
  type ConversionFormat,
  type ConversionStatus,
} from "@/lib/conversion-engine";

type OutputFormat = "png" | "jpeg" | "webp";

type ImageItem = {
  id: string;
  file: File;
  inputFormat: ConversionFormat;
  status: ConversionStatus;
  error: string;
  outputName: string;
  output: Blob | null;
  url: string;
  outputBytes: number;
};

const OUTPUT_FORMATS: { value: OutputFormat; label: string }[] = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
];

function statusLabel(status: ConversionStatus) {
  return status === "queued" ? "Queued"
    : status === "validating" ? "Validating"
    : status === "processing" ? "Converting"
    : status === "complete" ? "Complete"
    : status === "failed" ? "Failed"
    : status === "skipped" ? "Skipped"
    : "Cancelled";
}

export default function ImageConverter() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("webp");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [quality, setQuality] = useState(92);
  const [busy, setBusy] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [zipUrl, setZipUrl] = useState("");
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);

  const itemsRef = useRef<ImageItem[]>([]);
  const urlsRef = useRef<string[]>([]);
  const zipUrlRef = useRef("");
  const controllersRef = useRef(new Map<string, AbortController>());
  const batchControllerRef = useRef<AbortController | null>(null);
  const zipWorkerRef = useRef<Worker | null>(null);
  const runRef = useRef(0);
  const validationRef = useRef(0);
  const mountedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const skippedRef = useRef(new Set<string>());

  const updateItems = useCallback((update: (current: ImageItem[]) => ImageItem[]) => {
    const next = update(itemsRef.current);
    itemsRef.current = next;
    if (mountedRef.current) setItems(next);
  }, []);

  const revokeZip = useCallback(() => {
    if (zipUrlRef.current) {
      URL.revokeObjectURL(zipUrlRef.current);
      urlsRef.current = urlsRef.current.filter((url) => url !== zipUrlRef.current);
      zipUrlRef.current = "";
      setZipUrl("");
    }
  }, []);

  const addFiles = async (fileList: FileList | File[]) => {
    if (busy || zipBusy || fileList.length === 0) return;
    setError("");
    revokeZip();

    const selected = Array.from(fileList);
    const current = itemsRef.current;
    const currentBytes = current.reduce((sum, item) => sum + item.file.size, 0);

    if (current.length + selected.length > CONVERSION_LIMITS.batchFiles) {
      setError(`A batch can contain up to ${CONVERSION_LIMITS.batchFiles} files.`);
      return;
    }
    if (currentBytes + selected.reduce((sum, file) => sum + file.size, 0) > CONVERSION_LIMITS.batchBytes) {
      setError(`A batch can contain up to ${formatBytes(CONVERSION_LIMITS.batchBytes)} of input.`);
      return;
    }

    const epoch = validationRef.current;
    const additions: ImageItem[] = selected.map((file) => ({
      id: crypto.randomUUID(),
      file,
      inputFormat: "unknown",
      status: "validating",
      error: "",
      outputName: "",
      output: null,
      url: "",
      outputBytes: 0,
    }));

    updateItems((existing) => [...existing, ...additions]);

    await Promise.all(additions.map(async (item) => {
      try {
        if (item.file.size > CONVERSION_LIMITS.inputFileBytes) {
          throw new Error(`Each image must be no larger than ${formatBytes(CONVERSION_LIMITS.inputFileBytes)}.`);
        }
        if (item.file.size === 0) throw new Error("The selected file is empty.");

        const header = new Uint8Array(await item.file.slice(0, 1024).arrayBuffer());
        if (epoch !== validationRef.current) return;

        const detected = identifyInputFormat(header);
        if (!["png", "jpeg", "webp"].includes(detected)) {
          throw new Error(detected === "tiff"
            ? "TIFF input is recognized but is not supported by this converter."
            : "Unsupported or unrecognized image format. Choose PNG, JPEG or WebP.");
        }

        const capability = findConversionCapability(detected, outputFormat);
        if (!capability) throw new Error(`Conversion from ${detected.toUpperCase()} to ${outputFormat.toUpperCase()} is not supported.`);

        validateConversionInput(item.file, detected, capability);

        updateItems((existing) => existing.map((entry) =>
          entry.id === item.id
            ? { ...entry, inputFormat: detected, status: "queued", error: "" }
            : entry
        ));
      } catch (reason) {
        if (epoch !== validationRef.current) return;
        updateItems((existing) => existing.map((entry) =>
          entry.id === item.id
            ? { ...entry, status: "failed", error: reason instanceof Error ? reason.message : "Image validation failed." }
            : entry
        ));
      }
    }));

    if (inputRef.current) inputRef.current.value = "";
  };

  const runBatch = async (requestedIds?: string[]) => {
    if (busy) return;

    const ids = requestedIds ?? itemsRef.current
      .filter((item) => item.status === "queued")
      .map((item) => item.id);

    if (!ids.length) return;

    const run = ++runRef.current;
    const controller = new AbortController();
    batchControllerRef.current = controller;
    skippedRef.current.clear();
    setBusy(true);
    setError("");

    try {
      await runBoundedQueue(ids, CONVERSION_LIMITS.concurrentFiles, async (id) => {
        const item = itemsRef.current.find((entry) => entry.id === id);
        if (!item || item.status !== "queued" || controller.signal.aborted) return;

        const capability = findConversionCapability(item.inputFormat, outputFormat);
        if (!capability) {
          updateItems((existing) => existing.map((entry) => entry.id === id
            ? { ...entry, status: "failed", error: "No verified converter is available for this format pair." }
            : entry));
          return;
        }

        const itemController = new AbortController();
        controllersRef.current.set(id, itemController);

        updateItems((existing) => existing.map((entry) => entry.id === id
          ? { ...entry, status: "processing", error: "" }
          : entry));

        let convertedBytes: Uint8Array | null = null;

        try {
          const settings: Record<string, number> = { quality: quality / 100 };
          if (width.trim()) settings.width = Number(width);
          if (height.trim()) settings.height = Number(height);

          const result = await capability.convert(
            item.file,
            settings,
            itemController.signal,
            () => undefined
          );

          convertedBytes = result.bytes;
          validateConversionOutput(result.bytes, capability);

          const outputTotal = itemsRef.current.reduce((sum, entry) => sum + entry.outputBytes, 0);
          if (outputTotal + result.bytes.byteLength > CONVERSION_LIMITS.batchBytes) {
            throw new Error(`Converted files exceed the ${formatBytes(CONVERSION_LIMITS.batchBytes)} batch output limit.`);
          }

          const blob = new Blob([result.bytes.slice().buffer as ArrayBuffer], { type: capability.outputMediaType });
          result.bytes.fill(0);
          convertedBytes = null;

          const occupied = new Set(itemsRef.current
            .filter((entry) => entry.id !== id && entry.status === "complete")
            .map((entry) => entry.outputName.toLocaleLowerCase()));

          const outputName = safeOutputFilename(
            item.file.name,
            item.file.name.replace(/\.[^.]+$/, ""),
            capability.outputExtension,
            occupied
          );

          const url = URL.createObjectURL(blob);
          urlsRef.current.push(url);

          if (run === runRef.current && mountedRef.current) {
            updateItems((existing) => existing.map((entry) => entry.id === id
              ? { ...entry, status: "complete", output: blob, url, outputName, outputBytes: blob.size, error: "" }
              : entry));
          } else {
            URL.revokeObjectURL(url);
            urlsRef.current = urlsRef.current.filter((entry) => entry !== url);
          }
        } catch (reason) {
          convertedBytes?.fill(0);
          if (skippedRef.current.has(id)) return;

          const cancelled = itemController.signal.aborted || controller.signal.aborted ||
            (reason instanceof DOMException && reason.name === "AbortError");

          if (run === runRef.current && mountedRef.current) {
            updateItems((existing) => existing.map((entry) => entry.id === id
              ? { ...entry, status: cancelled ? "cancelled" : "failed", error: cancelled ? "Conversion cancelled." : reason instanceof Error ? reason.message : "Conversion failed." }
              : entry));
          }
        } finally {
          controllersRef.current.delete(id);
        }
      }, controller.signal);
    } catch {
      if (run === runRef.current && mountedRef.current) setError("The conversion batch could not be scheduled.");
    } finally {
      if (run === runRef.current && mountedRef.current) {
        setBusy(false);
        batchControllerRef.current = null;
      }
    }
  };

  const cancelBatch = () => {
    ++runRef.current;
    batchControllerRef.current?.abort();
    batchControllerRef.current = null;
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();

    updateItems((existing) => existing.map((item) =>
      item.status === "processing" || item.status === "queued"
        ? { ...item, status: "cancelled", error: "Conversion cancelled." }
        : item
    ));

    setBusy(false);
    setError("Batch cancelled. Active conversions were aborted and queued items were cancelled.");
  };

  const retryItem = (id: string) => {
    if (busy) return;
    updateItems((existing) => existing.map((item) => item.id === id && item.status === "failed"
      ? { ...item, status: "queued", error: "" }
      : item));
    void runBatch([id]);
  };

  const skipItem = (id: string) => {
    skippedRef.current.add(id);
    controllersRef.current.get(id)?.abort();
    updateItems((existing) => existing.map((item) => item.id === id &&
      ["queued", "failed", "processing", "cancelled"].includes(item.status)
      ? { ...item, status: "skipped", error: "Skipped by user." }
      : item));
  };

  const makeZip = async () => {
    const completed = itemsRef.current.filter((item) => item.status === "complete" && item.output);
    if (!completed.length || busy || zipBusy) return;

    revokeZip();
    setZipBusy(true);
    setError("");
    const run = ++runRef.current;

    try {
      const files = await Promise.all(completed.map(async (item) => ({
        name: item.outputName,
        bytes: await item.output!.arrayBuffer(),
      })));

      if (run !== runRef.current) {
        files.forEach(({ bytes }) => new Uint8Array(bytes).fill(0));
        return;
      }

      const worker = new Worker(new URL("@/workers/zip-files.worker.ts", import.meta.url), { type: "module" });
      zipWorkerRef.current = worker;

      worker.onmessage = (event: MessageEvent<{ ok: boolean; bytes?: ArrayBuffer; error?: string }>) => {
        worker.terminate();
        zipWorkerRef.current = null;
        setZipBusy(false);

        if (!mountedRef.current || run !== runRef.current) {
          if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0);
          return;
        }

        if (!event.data.ok || !event.data.bytes || event.data.bytes.byteLength < 22 ||
            event.data.bytes.byteLength > CONVERSION_LIMITS.batchBytes + 1024 * 1024) {
          if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0);
          setError(event.data.error ?? "The ZIP archive failed output validation.");
          return;
        }

        const signature = new Uint8Array(event.data.bytes, 0, 4);
        if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
          new Uint8Array(event.data.bytes).fill(0);
          setError("The ZIP archive has an invalid signature.");
          return;
        }

        const url = URL.createObjectURL(new Blob([event.data.bytes], { type: "application/zip" }));
        urlsRef.current.push(url);
        zipUrlRef.current = url;
        setZipUrl(url);
        new Uint8Array(event.data.bytes).fill(0);
      };

      worker.onerror = () => {
        worker.terminate();
        zipWorkerRef.current = null;
        if (mountedRef.current && run === runRef.current) {
          setZipBusy(false);
          setError("ZIP creation stopped unexpectedly.");
        }
      };

      worker.postMessage({ files }, files.map(({ bytes }) => bytes));
    } catch {
      if (mountedRef.current && run === runRef.current) {
        setZipBusy(false);
        setError("Unable to prepare the ZIP archive.");
      }
    }
  };

  const cancelZip = () => {
    ++runRef.current;
    zipWorkerRef.current?.terminate();
    zipWorkerRef.current = null;
    setZipBusy(false);
    setError("ZIP creation cancelled. Individual downloads remain available.");
  };

  const clearBatch = () => {
    if (busy || zipBusy || items.some((item) => item.status === "validating")) return;
    ++validationRef.current;
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
    zipUrlRef.current = "";
    itemsRef.current = [];
    setItems([]);
    setZipUrl("");
    setError("");
  };

  useEffect(() => {
    mountedRef.current = true;
    const controllers = controllersRef.current;
    const runCounter = runRef;
    const validationCounter = validationRef;
    return () => {
      mountedRef.current = false;
      ++runCounter.current;
      ++validationCounter.current;
      batchControllerRef.current?.abort();
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      zipWorkerRef.current?.terminate();
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = [];
      zipUrlRef.current = "";
    };
  }, []);

  const completedCount = items.filter((item) => item.status === "complete").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const queueCount = items.filter((item) => item.status === "queued").length;
  const validatingCount = items.filter((item) => item.status === "validating").length;

  return (
    <section className="merge-panel" aria-labelledby="image-converter-heading">
      <h2 id="image-converter-heading">Convert images on this device</h2>
      <p>Convert PNG, JPEG and WebP images between supported formats. Resize images while preserving their aspect ratio. TIFF is detected but is not yet supported for conversion.</p>

      <div className="privacy-note">
        Images are processed locally in your browser. Up to {CONVERSION_LIMITS.batchFiles} files, {formatBytes(CONVERSION_LIMITS.inputFileBytes)} each and {formatBytes(CONVERSION_LIMITS.batchBytes)} total. At most {CONVERSION_LIMITS.concurrentFiles} conversions run at once. No image upload is required.
      </div>

      <label className="file-picker">
        Choose images
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          multiple
          disabled={busy || zipBusy}
          onChange={(event) => { if (event.currentTarget.files) void addFiles(event.currentTarget.files); }}
        />
      </label>

      <div
        className={`drop-zone ${dragActive ? "drop-active" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
        onDrop={(event) => { event.preventDefault(); setDragActive(false); if (event.dataTransfer.files) void addFiles(event.dataTransfer.files); }}
      >
        Drop PNG, JPEG or WebP images here, or use the file picker.
      </div>

      <div className="split-settings">
        <label htmlFor="image-output-format">Output format</label>
        <select id="image-output-format" className="split-range-input" value={outputFormat} disabled={busy || zipBusy || items.length > 0} onChange={(event) => setOutputFormat(event.target.value as OutputFormat)}>
          {OUTPUT_FORMATS.map((format) => <option key={format.value} value={format.value}>{format.label}</option>)}
        </select>
      </div>

      <div className="split-settings">
        <label htmlFor="image-width">Maximum width (pixels)</label>
        <input id="image-width" className="split-range-input" type="number" min="1" max="12000" value={width} disabled={busy || zipBusy} placeholder="Original width" onChange={(event) => setWidth(event.target.value)} />
      </div>

      <div className="split-settings">
        <label htmlFor="image-height">Maximum height (pixels)</label>
        <input id="image-height" className="split-range-input" type="number" min="1" max="12000" value={height} disabled={busy || zipBusy} placeholder="Original height" onChange={(event) => setHeight(event.target.value)} />
      </div>

      <div className="split-settings">
        <label htmlFor="image-quality">Output quality: {quality}%</label>
        <input id="image-quality" type="range" min="10" max="100" step="1" value={quality} disabled={busy || zipBusy || outputFormat === "png"} onChange={(event) => setQuality(Number(event.target.value))} />
      </div>

      <p className="tool-description">Resize values define a maximum bounding box; the original aspect ratio is preserved. Leave both dimensions empty to retain the original size. Quality applies to JPEG and WebP; PNG is lossless.</p>

      {items.length > 0 && (
        <>
          <p role="status" aria-live="polite" className="route-note">
            Batch: {completedCount} complete, {queueCount} queued, {validatingCount} validating, {failedCount} failed.
          </p>
          <ol className="merge-list conversion-list" aria-label="Image conversion batch">
            {items.map((item) => (
              <li key={item.id} className="conversion-item">
                <span className="merge-order" aria-label={statusLabel(item.status)}>{statusLabel(item.status)}</span>
                <div className="conversion-item-main">
                  <strong className="merge-filename" title={item.file.name}>{item.file.name}</strong>
                  <span className="tool-description">{formatBytes(item.file.size)} · detected {item.inputFormat.toUpperCase()}</span>
                  {item.status === "failed" && <span className="merge-error">{item.error}</span>}
                  {item.status === "complete" && <span className="tool-description">Validated output · {formatBytes(item.outputBytes)}</span>}
                  {item.status === "complete" && item.url && <a className="text-link" href={item.url} download={item.outputName}>{item.outputName}</a>}
                  {item.status === "failed" && <button type="button" onClick={() => retryItem(item.id)} disabled={busy}>Retry</button>}
                  {["queued", "failed", "processing", "cancelled"].includes(item.status) && <button type="button" onClick={() => skipItem(item.id)}>Skip</button>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="merge-actions">
        <button type="button" className="hero-cta" disabled={busy || queueCount === 0 || validatingCount > 0} onClick={() => void runBatch()}>
          {busy ? "Converting images…" : `Convert ${queueCount} queued image${queueCount === 1 ? "" : "s"}`}
        </button>
        {busy && <button type="button" onClick={cancelBatch}>Cancel batch</button>}
        {zipBusy && <button type="button" onClick={cancelZip}>Cancel ZIP creation</button>}
        {completedCount > 0 && <button type="button" onClick={() => void makeZip()} disabled={busy || zipBusy}>Download completed images as ZIP</button>}
        {items.length > 0 && <button type="button" onClick={clearBatch} disabled={busy || zipBusy || validatingCount > 0}>Clear batch</button>}
      </div>

      {error && <p role="alert" className="merge-error">{error}</p>}
      {zipUrl && <div className="merge-success"><p>ZIP archive is ready.</p><a href={zipUrl} download={`apos-images-${outputFormat}.zip`}>Download ZIP archive</a></div>}
    </section>
  );
}
