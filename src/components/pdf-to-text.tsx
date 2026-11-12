"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CONVERSION_LIMITS, conversionCapabilities, findConversionCapability, formatBytes, identifyInputFormat, runBoundedQueue, safeOutputFilename, validateConversionInput, validateConversionOutput, type ConversionFormat, type ConversionResult, type ConversionStatus } from "@/lib/conversion-engine";
import { PDF_LIMITS } from "@/lib/pdf-limits";

type TextSettingsMode = "global" | "include" | "omit";
type PageSettingsMode = "global" | "all" | "custom";
type ConversionItem = {
  id: string;
  file: File;
  inputFormat: ConversionFormat;
  status: ConversionStatus;
  error: string;
  requestedName: string;
  outputName: string;
  textSettings: TextSettingsMode;
  pageSettings: PageSettingsMode;
  pageRange: string;
  completedPages: number;
  totalPages: number;
  output: Blob | null;
  url: string;
  outputBytes: number;
  warnings: string[];
  preview: string;
  archive: Blob | null;
  archiveUrl: string;
  archiveName: string;
};

function statusLabel(status: ConversionStatus) {
  return status === "queued" ? "Queued" : status === "validating" ? "Validating" : status === "processing" ? "Processing" : status === "complete" ? "Complete" : status === "failed" ? "Failed" : status === "skipped" ? "Skipped" : "Cancelled";
}

function invalidateRun(counter: { current: number }) { counter.current += 1; }
function abortControllers(controllers: Map<string, AbortController>) { controllers.forEach((controller) => controller.abort()); controllers.clear(); }

function outputNames(items: ConversionItem[], extension: string) {
  const occupied = new Set<string>();
  return items.map((item) => ({ ...item, outputName: safeOutputFilename(item.file.name, item.requestedName, extension, occupied) }));
}

function ConversionPreview({ item, copied, onCopy }: { item: ConversionItem; copied: boolean; onCopy: () => void }) {
  const [open, setOpen] = useState(false);
  return <details className="conversion-preview" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Preview extracted text</summary>
    {open ? <pre>{item.preview}</pre> : null}
    <button type="button" onClick={onCopy}>{copied ? "Copied" : "Copy extracted text"}</button>
  </details>;
}

export default function PdfToText({ outputFormat = "txt" }: { outputFormat?: "txt" | "html" }) {
  const [items, setItems] = useState<ConversionItem[]>([]);
  const [includePageLabels, setIncludePageLabels] = useState(true);
  const [defaultPageMode, setDefaultPageMode] = useState<"all" | "custom">("all");
  const [defaultPageRange, setDefaultPageRange] = useState("");
  const [htmlMode, setHtmlMode] = useState<"reading" | "layout">("reading");
  const [includePictures, setIncludePictures] = useState(true);
  const [includeTables, setIncludeTables] = useState(true);
  const [busy, setBusy] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [zipUrl, setZipUrl] = useState("");
  const [reportUrl, setReportUrl] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const itemsRef = useRef<ConversionItem[]>([]);
  const urlsRef = useRef<string[]>([]);
  const zipUrlRef = useRef("");
  const reportUrlRef = useRef("");
  const controllersRef = useRef(new Map<string, AbortController>());
  const skippedRef = useRef(new Set<string>());
  const batchControllerRef = useRef<AbortController | null>(null);
  const zipWorkerRef = useRef<Worker | null>(null);
  const runRef = useRef(0);
  const validationEpochRef = useRef(0);
  const mountedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateItems = useCallback((update: (current: ConversionItem[]) => ConversionItem[]) => {
    const next = outputNames(update(itemsRef.current), outputFormat);
    itemsRef.current = next;
    if (mountedRef.current) setItems(next);
  }, [outputFormat]);

  const revokeAuxiliaryUrls = () => {
    for (const url of [zipUrlRef.current, reportUrlRef.current]) {
      if (url) { URL.revokeObjectURL(url); urlsRef.current = urlsRef.current.filter((candidate) => candidate !== url); }
    }
    zipUrlRef.current = ""; reportUrlRef.current = "";
    setZipUrl(""); setReportUrl("");
  };

  const addFiles = async (fileList: FileList | File[]) => {
    if (busy || zipBusy || fileList.length === 0) return;
    setError(""); revokeAuxiliaryUrls();
    const selected = Array.from(fileList);
    const current = itemsRef.current;
    const currentBytes = current.reduce((sum, item) => sum + item.file.size, 0);
    if (current.length + selected.length > CONVERSION_LIMITS.batchFiles) { setError(`A batch can contain up to ${CONVERSION_LIMITS.batchFiles} files.`); return; }
    if (currentBytes + selected.reduce((sum, file) => sum + file.size, 0) > CONVERSION_LIMITS.batchBytes) { setError(`A batch can contain up to ${formatBytes(CONVERSION_LIMITS.batchBytes)} of input.`); return; }
    const validationEpoch = validationEpochRef.current;
    const additions = selected.map((file) => ({
      id: crypto.randomUUID(), file, inputFormat: "unknown" as ConversionFormat, status: "validating" as ConversionStatus, error: "",
      requestedName: file.name.replace(/\.[^.]+$/, "") || "document", outputName: "", textSettings: "global" as TextSettingsMode,
      pageSettings: "global" as PageSettingsMode, pageRange: "",
      completedPages: 0, totalPages: 0, output: null, url: "", outputBytes: 0,
      warnings: [] as string[], preview: "", archive: null, archiveUrl: "", archiveName: "",
    }));
    updateItems((existing) => [...existing, ...additions]);
    await Promise.all(additions.map(async (item) => {
      try {
        if (item.file.size > CONVERSION_LIMITS.inputFileBytes) throw new Error("This PDF converter accepts files up to 25 MB each.");
        const bytes = new Uint8Array(await item.file.slice(0, 1024).arrayBuffer());
        if (validationEpoch !== validationEpochRef.current) return;
        const format = identifyInputFormat(bytes);
        const capability = findConversionCapability(format, outputFormat);
        if (!capability) {
          const label = format === "unknown" ? "The file signature is unsupported or unrecognized." : `The signature identifies ${format.toUpperCase()}, for which this batch has no verified converter yet.`;
          throw new Error(label);
        }
        validateConversionInput(item.file, format, capability);
        updateItems((existing) => existing.map((entry) => entry.id === item.id ? { ...entry, inputFormat: format, status: "queued", error: "" } : entry));
      } catch (reason) {
        if (validationEpoch !== validationEpochRef.current) return;
        updateItems((existing) => existing.map((entry) => entry.id === item.id ? { ...entry, status: "failed", error: reason instanceof Error ? reason.message : "The file could not be validated." } : entry));
      }
    }));
    if (inputRef.current) inputRef.current.value = "";
  };

  const runBatch = async (requestedIds?: string[]) => {
    if (busy) return;
    const ids = requestedIds ?? itemsRef.current.filter((item) => item.status === "queued").map((item) => item.id);
    if (ids.length === 0) return;
    const run = ++runRef.current;
    const controller = new AbortController();
    batchControllerRef.current = controller;
    skippedRef.current.clear();
    setError(""); setBusy(true);
    const converter = findConversionCapability("pdf", outputFormat);
    if (!converter) { setBusy(false); setError("No verified converter is configured for this output format."); return; }
    try {
      await runBoundedQueue(ids, CONVERSION_LIMITS.concurrentFiles, async (id) => {
        const item = itemsRef.current.find((entry) => entry.id === id);
        if (!item || item.status !== "queued" || controller.signal.aborted) return;
        const itemController = new AbortController();
        controllersRef.current.set(id, itemController);
        updateItems((existing) => existing.map((entry) => entry.id === id ? { ...entry, status: "processing", error: "", completedPages: 0, totalPages: 0 } : entry));
        const includeLabels = item.textSettings === "global" ? includePageLabels : item.textSettings === "include";
        const pages = item.pageSettings === "custom"
          ? item.pageRange
          : item.pageSettings === "all"
            ? ""
            : defaultPageMode === "custom" ? defaultPageRange : "";
        if (item.pageSettings === "custom" && !item.pageRange.trim()) throw new Error("Enter a page range for this file, such as 1-3, 5.");
        if (item.pageSettings === "global" && defaultPageMode === "custom" && !defaultPageRange.trim()) throw new Error("Enter a default page range or switch the batch default to all pages.");
        let convertedBytes: Uint8Array | null = null;
        try {
          const result: ConversionResult = await converter.convert(item.file, {
            includePageLabels: includeLabels,
            pages,
            layout: htmlMode,
            includePictures,
            includeTables,
          }, itemController.signal, (progress) => {
            if (run !== runRef.current || !mountedRef.current) return;
            updateItems((existing) => existing.map((entry) => entry.id === id ? { ...entry, completedPages: progress.completed, totalPages: progress.total } : entry));
          });
          convertedBytes = result.bytes;
          validateConversionOutput(result.bytes, converter);
          const outputTotal = itemsRef.current.reduce((sum, entry) => sum + entry.outputBytes, 0);
          if (outputTotal + result.bytes.byteLength + (result.archive?.bytes.byteLength ?? 0) > CONVERSION_LIMITS.batchBytes) throw new Error(`Validated outputs would exceed the ${formatBytes(CONVERSION_LIMITS.batchBytes)} batch output limit.`);
          const preview = outputFormat === "txt" ? new TextDecoder("utf-8").decode(result.bytes.subarray(0, 4000)) : "";
          const blob = new Blob([result.bytes.slice().buffer as ArrayBuffer], { type: converter.outputMediaType });
          result.bytes.fill(0); convertedBytes = null;
          const url = URL.createObjectURL(blob);
          urlsRef.current.push(url);
          let archive: Blob | null = null;
          let archiveUrl = "";
          let archiveName = "";
          if (result.archive) {
            const archiveBytes = result.archive.bytes;
            if (archiveBytes.byteLength < 22 || archiveBytes[0] !== 0x50 || archiveBytes[1] !== 0x4b) {
              archiveBytes.fill(0);
              throw new Error("The generated HTML package failed ZIP validation.");
            }
            archive = new Blob([archiveBytes.slice().buffer as ArrayBuffer], { type: "application/zip" });
            archiveBytes.fill(0);
            archiveUrl = URL.createObjectURL(archive);
            urlsRef.current.push(archiveUrl);
            archiveName = result.archive.name;
          }
          if (run === runRef.current && mountedRef.current) updateItems((existing) => existing.map((entry) => entry.id === id ? {
            ...entry,
            status: "complete",
            output: blob,
            url,
            outputBytes: blob.size + (archive?.size ?? 0),
            completedPages: result.pageCount ?? 0,
            totalPages: result.pageCount ?? 0,
            error: "",
            warnings: result.warnings ?? [],
            preview,
            archive,
            archiveUrl,
            archiveName,
          } : entry));
        } catch (reason) {
          convertedBytes?.fill(0);
          if (skippedRef.current.has(id)) return;
          const wasCancelled = itemController.signal.aborted || controller.signal.aborted || (reason instanceof DOMException && reason.name === "AbortError");
          if (run === runRef.current && mountedRef.current) updateItems((existing) => existing.map((entry) => entry.id === id ? { ...entry, status: wasCancelled ? "cancelled" : "failed", error: wasCancelled ? "Conversion cancelled." : reason instanceof Error ? reason.message : "Conversion failed." } : entry));
        } finally { controllersRef.current.delete(id); }
      }, controller.signal);
    } catch { if (run === runRef.current && mountedRef.current) setError("The batch could not be scheduled."); }
    finally {
      if (run === runRef.current && mountedRef.current) { setBusy(false); batchControllerRef.current = null; }
    }
  };

  const cancelBatch = () => {
    ++runRef.current;
    batchControllerRef.current?.abort(); batchControllerRef.current = null;
    controllersRef.current.forEach((controller) => controller.abort()); controllersRef.current.clear();
    zipWorkerRef.current?.terminate(); zipWorkerRef.current = null; setZipBusy(false);
    updateItems((existing) => existing.map((item) => item.status === "processing" || item.status === "queued" ? { ...item, status: "cancelled", error: "Conversion cancelled." } : item));
    setBusy(false); setError("Batch cancelled. Active PDF workers were stopped and queued items were cancelled.");
  };

  const cancelZip = () => {
    ++runRef.current;
    zipWorkerRef.current?.terminate(); zipWorkerRef.current = null;
    setZipBusy(false); setError("ZIP creation cancelled. Validated individual text downloads remain available.");
  };

  const skipItem = (id: string) => {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (!item || !["queued", "failed", "processing", "cancelled"].includes(item.status)) return;
    skippedRef.current.add(id);
    controllersRef.current.get(id)?.abort();
    updateItems((existing) => existing.map((entry) => entry.id === id ? { ...entry, status: "skipped", error: "Skipped by user." } : entry));
  };

  const retryItem = (id: string) => {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (!item || item.status !== "failed" || busy) return;
    skippedRef.current.delete(id);
    updateItems((existing) => existing.map((entry) => entry.id === id ? { ...entry, status: "queued", error: "", completedPages: 0, totalPages: 0 } : entry));
    void runBatch([id]);
  };

  const updateItemSetting = (id: string, update: Partial<Pick<ConversionItem, "requestedName" | "textSettings" | "pageSettings" | "pageRange">>) => {
    revokeAuxiliaryUrls();
    updateItems((existing) => existing.map((item) => item.id === id && ["queued", "failed", "cancelled", "skipped"].includes(item.status) ? { ...item, ...update } : item));
  };

  const copyPreview = async (item: ConversionItem) => {
    if (!item.preview) return;
    try {
      await navigator.clipboard.writeText(item.preview);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId((current) => current === item.id ? "" : current), 2200);
    } catch {
      setError("The browser did not allow clipboard access. Select the preview text and copy it manually.");
    }
  };

  const makeZip = async () => {
    const completed = itemsRef.current.filter((item) => item.status === "complete" && item.output);
    if (!completed.length || zipBusy || busy) return;
    revokeAuxiliaryUrls(); setZipBusy(true); setError("");
    const run = ++runRef.current;
    try {
      const files = await Promise.all(completed.map(async (item) => ({ name: item.outputName, bytes: await item.output!.arrayBuffer() })));
      if (run !== runRef.current) { files.forEach(({ bytes }) => new Uint8Array(bytes).fill(0)); return; }
      const worker = new Worker(new URL("@/workers/zip-files.worker.ts", import.meta.url), { type: "module" });
      zipWorkerRef.current = worker;
      worker.onmessage = (event: MessageEvent<{ ok: boolean; bytes?: ArrayBuffer; error?: string }>) => {
        worker.terminate(); zipWorkerRef.current = null; setZipBusy(false);
        if (!mountedRef.current || run !== runRef.current) { if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0); return; }
        if (!event.data.ok || !event.data.bytes || event.data.bytes.byteLength < 22 || event.data.bytes.byteLength > CONVERSION_LIMITS.batchBytes + 1024 * 1024) {
          if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0);
          setError(event.data.error ?? "The generated ZIP did not pass output validation."); return;
        }
        const signature = new Uint8Array(event.data.bytes, 0, 4);
        if (signature[0] !== 0x50 || signature[1] !== 0x4b) { new Uint8Array(event.data.bytes).fill(0); setError("The generated ZIP did not have a valid archive signature."); return; }
        const url = URL.createObjectURL(new Blob([event.data.bytes], { type: "application/zip" }));
        urlsRef.current.push(url); zipUrlRef.current = url; setZipUrl(url); new Uint8Array(event.data.bytes).fill(0);
      };
      worker.onerror = () => { worker.terminate(); zipWorkerRef.current = null; if (mountedRef.current && run === runRef.current) { setZipBusy(false); setError("ZIP creation stopped unexpectedly."); } };
      worker.postMessage({ files }, files.map(({ bytes }) => bytes));
    } catch { if (mountedRef.current && run === runRef.current) { setZipBusy(false); setError("Unable to prepare the ZIP archive."); } }
  };

  const makeErrorReport = () => {
    const failed = itemsRef.current.filter((item) => item.status === "failed" || item.status === "skipped" || item.status === "cancelled");
    if (!failed.length) return;
    revokeAuxiliaryUrls();
    const report = [`APOS PDF to ${outputFormat === "html" ? "HTML" : "text"} batch report`, "", ...failed.map((item) => `${item.file.name} — ${statusLabel(item.status)}: ${item.error || "No additional details."}`)].join("\n");
    const url = URL.createObjectURL(new Blob([report], { type: "text/plain;charset=utf-8" }));
    urlsRef.current.push(url); reportUrlRef.current = url; setReportUrl(url);
  };

  const clearBatch = () => {
    if (busy || zipBusy) return;
    ++validationEpochRef.current;
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url)); urlsRef.current = [];
    itemsRef.current = []; zipUrlRef.current = ""; reportUrlRef.current = ""; setItems([]); setError(""); setZipUrl(""); setReportUrl("");
  };

  useEffect(() => {
    mountedRef.current = true;
    const runCounter = runRef;
    const validationCounter = validationEpochRef;
    const activeControllers = controllersRef.current;
    return () => {
      mountedRef.current = false; invalidateRun(runCounter); batchControllerRef.current?.abort();
      invalidateRun(validationCounter);
      abortControllers(activeControllers);
      zipWorkerRef.current?.terminate(); urlsRef.current.forEach((url) => URL.revokeObjectURL(url)); urlsRef.current = []; zipUrlRef.current = ""; reportUrlRef.current = "";
    };
  }, []);

  const completedCount = items.filter((item) => item.status === "complete").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const activeCount = items.filter((item) => item.status === "processing" || item.status === "validating").length;
  const queueCount = items.filter((item) => item.status === "queued").length;
  const progress = items.filter((item) => item.totalPages > 0).reduce((sum, item) => sum + item.completedPages, 0);
  const totalProgress = items.reduce((sum, item) => sum + item.totalPages, 0);
  const converter = findConversionCapability("pdf", outputFormat) ?? conversionCapabilities[0];
  const outputLabel = outputFormat === "html" ? "HTML" : "text";

  return <section className="merge-panel" aria-labelledby="pdf-to-text-heading">
    <h2 id="pdf-to-text-heading">Convert PDF to {outputLabel} on this device</h2>
    <p>{outputFormat === "html"
      ? "Turn selectable PDF text into a safe, responsive HTML document. Reading mode rebuilds headings, paragraphs and tables; layout mode approximates the original page arrangement. Pictures and tables can be included, and the complete HTML package is available with its assets in a ZIP."
      : "Extract selectable text from PDF pages into UTF-8 plain-text files, with optional page headings, custom page ranges, previews and batch downloads. Scanned pages without a text layer need OCR, which is not included in this converter."}</p>
    <div className="privacy-note">Input is identified from its file signature. Up to {converter.maxBatchFiles} PDFs, {formatBytes(converter.maxFileBytes)} each and {formatBytes(converter.maxBatchBytes)} total; at most {CONVERSION_LIMITS.concurrentFiles} files are processed at once and each PDF is limited to {PDF_LIMITS.pages} pages. PDF reading order follows the content order encoded by the source file. Nothing is uploaded.</div>
    <label className="file-picker">Choose PDF files<input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple disabled={busy || zipBusy} onChange={(event) => { if (event.currentTarget.files) void addFiles(event.currentTarget.files); }}/></label>
    <div className={`drop-zone ${dragActive ? "drop-active" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }} onDrop={(event) => { event.preventDefault(); setDragActive(false); if (event.dataTransfer.files) void addFiles(event.dataTransfer.files); }}>
      Drop PDF files here, or use the accessible file picker above.
    </div>

    <fieldset className="conversion-options">
      <legend>Batch defaults</legend>
      <label htmlFor="pdf-text-page-labels">Default page labels
        <select id="pdf-text-page-labels" value={includePageLabels ? "include" : "omit"} disabled={busy} onChange={(event) => setIncludePageLabels(event.target.value === "include")}><option value="include">Include page headings</option><option value="omit">Omit page headings</option></select>
      </label>
      <label htmlFor="pdf-text-default-pages">Default pages
        <select id="pdf-text-default-pages" value={defaultPageMode} disabled={busy} onChange={(event) => setDefaultPageMode(event.target.value as "all" | "custom")}><option value="all">All pages</option><option value="custom">Custom page range</option></select>
      </label>
      {defaultPageMode === "custom" && <label htmlFor="pdf-text-default-range">Default page range
        <input id="pdf-text-default-range" value={defaultPageRange} disabled={busy} onChange={(event) => setDefaultPageRange(event.target.value)} placeholder="1-3, 5" aria-describedby="pdf-text-default-range-help" />
        <span id="pdf-text-default-range-help" className="route-note">Use page numbers or ranges, such as 1-3, 5. Selected pages keep the entered order.</span>
      </label>}
      {outputFormat === "html" && <>
        <label htmlFor="pdf-html-mode">HTML mode
          <select id="pdf-html-mode" value={htmlMode} disabled={busy} onChange={(event) => setHtmlMode(event.target.value as "reading" | "layout")}><option value="reading">Reading mode — responsive and semantic</option><option value="layout">Layout mode — approximate page arrangement</option></select>
        </label>
        <label className="office-check"><input type="checkbox" checked={includePictures} disabled={busy} onChange={(event) => setIncludePictures(event.target.checked)} /> Include pictures found in the PDF</label>
        <label className="office-check"><input type="checkbox" checked={includeTables} disabled={busy} onChange={(event) => setIncludeTables(event.target.checked)} /> Detect and include tables</label>
      </>}
    </fieldset>

    {items.length > 0 && <>
      <p role="status" aria-live="polite" className="route-note">Batch: {completedCount} complete, {queueCount} queued, {activeCount} active, {failedCount} failed. {totalProgress > 0 && `Extracted ${progress} of ${totalProgress} pages.`}</p>
      <ol className="merge-list conversion-list" aria-label="Conversion batch">
        {items.map((item) => <li key={item.id} className="conversion-item">
          <span className="merge-order" aria-label={statusLabel(item.status)}>{statusLabel(item.status)}</span>
          <div className="conversion-item-main"><strong className="merge-filename" title={item.file.name}>{item.file.name}</strong><span className="tool-description">{formatBytes(item.file.size)} · detected {item.inputFormat.toUpperCase()}</span>
            {(item.totalPages > 0 || item.status === "processing") && <span className="tool-description">{item.totalPages ? `Pages ${item.completedPages} of ${item.totalPages}` : "Opening and validating PDF…"}</span>}
            {item.status === "failed" && <span className="merge-error">{item.error}</span>}
            {item.status === "complete" && <span className="tool-description">Validated {item.outputBytes ? formatBytes(item.outputBytes) : "output"} · {item.totalPages} page(s)</span>}
            {item.warnings.map((warning) => <span key={warning} className="office-convert__warning" role="status">{warning}</span>)}
            <label className="conversion-setting">Output filename<input aria-label={`Output filename for ${item.file.name}`} value={item.requestedName} disabled={busy || item.status === "complete"} onChange={(event) => updateItemSetting(item.id, { requestedName: event.target.value })}/></label>
            <label className="conversion-setting">Page headings<select aria-label={`Page headings for ${item.file.name}`} value={item.textSettings} disabled={busy || item.status === "complete"} onChange={(event) => updateItemSetting(item.id, { textSettings: event.target.value as TextSettingsMode })}><option value="global">Use batch default</option><option value="include">Include headings</option><option value="omit">Omit headings</option></select></label>
            <label className="conversion-setting">Pages<select aria-label={`Pages for ${item.file.name}`} value={item.pageSettings} disabled={busy || item.status === "complete"} onChange={(event) => updateItemSetting(item.id, { pageSettings: event.target.value as PageSettingsMode })}><option value="global">Use batch default</option><option value="all">All pages</option><option value="custom">Custom page range</option></select></label>
            {item.pageSettings === "custom" && <label className="conversion-setting">Page range<input aria-label={`Page range for ${item.file.name}`} value={item.pageRange} disabled={busy || item.status === "complete"} onChange={(event) => updateItemSetting(item.id, { pageRange: event.target.value })} placeholder="1-3, 5"/></label>}
            {item.status === "complete" && item.url && <a className="text-link" href={item.url} download={item.outputName}>{item.outputName}</a>}
            {item.status === "complete" && item.archiveUrl && <a className="text-link" href={item.archiveUrl} download={item.archiveName}>Download ZIP package · {item.archiveName}</a>}
            {item.status === "complete" && outputFormat === "html" && item.url && <a className="text-link" href={item.url} target="_blank" rel="noopener noreferrer">Preview HTML in a new tab</a>}
            {item.status === "complete" && outputFormat === "txt" && item.preview && <ConversionPreview item={item} copied={copiedId === item.id} onCopy={() => void copyPreview(item)} />}
            {item.status === "failed" && <button type="button" onClick={() => retryItem(item.id)} disabled={busy}>Retry</button>}
            {["queued", "failed", "processing", "cancelled"].includes(item.status) && <button type="button" onClick={() => skipItem(item.id)}>Skip</button>}
          </div>
        </li>)}
      </ol>
    </>}
    <div className="merge-actions">
      <button type="button" className="hero-cta" disabled={busy || queueCount === 0} onClick={() => void runBatch()}>{busy ? "Converting files…" : `Convert ${queueCount} queued file${queueCount === 1 ? "" : "s"} to ${outputLabel}`}</button>
      {busy && <button type="button" onClick={cancelBatch}>Cancel batch</button>}
      {zipBusy && <button type="button" onClick={cancelZip}>Cancel ZIP creation</button>}
      {completedCount > 0 && <button type="button" onClick={() => void makeZip()} disabled={busy || zipBusy}>{zipBusy ? "Creating ZIP…" : "Download completed files as ZIP"}</button>}
      {failedCount > 0 && <button type="button" onClick={makeErrorReport}>Download error report</button>}
      {items.length > 0 && <button type="button" onClick={clearBatch} disabled={busy || zipBusy || items.some((item) => item.status === "validating")}>Clear batch</button>}
    </div>
    {error && <p role="alert" className="merge-error">{error}</p>}
    {error.includes("OCR") && <p className="route-note"><Link className="text-link" href="/tools/ocr-pdf">Open OCR PDF</Link> to add a searchable text layer first.</p>}
    {zipUrl && <div className="merge-success"><p>ZIP archive is ready from validated outputs.</p><a href={zipUrl} download={`apos-converted-${outputFormat === "txt" ? "text" : outputFormat}.zip`}>Download completed files as ZIP</a></div>}
    {reportUrl && <div className="merge-success"><p>Batch error report is ready.</p><a href={reportUrl} download="apos-conversion-report.txt">Download error report</a></div>}
  </section>;
}
