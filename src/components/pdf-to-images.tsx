"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import { checkPdfHeader, PDF_LIMITS } from "@/lib/pdf-limits";
import { assertImageWorkBounds, checkInputLimits, PDF_IMAGE_LIMITS, safeFileStem, selectedImagePages, validateRenderedImage } from "@/lib/pdf-images";
import { formatSelectedPages } from "@/lib/pdf-page-selection";
import { PdfPageGrid } from "@/components/pdf-tools/pdf-page-grid";
import { usePdfDocument } from "@/components/pdf-tools/use-pdf-document";

type ImageOutput = { name: string; url: string; blob: Blob; width: number; height: number };
type ZipReply = { ok: boolean; bytes?: ArrayBuffer; error?: string };

const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

const RESOLUTIONS = [
  { value: "1", label: "72 DPI · screen", scale: 1 },
  { value: "1.5", label: "108 DPI · 1.5×", scale: 1.5 },
  { value: "2", label: "144 DPI · 2×", scale: 2 },
  { value: "150", label: "150 DPI · print draft", scale: 150 / 72 },
  { value: "200", label: "200 DPI · high quality", scale: 200 / 72 },
  { value: "300", label: "300 DPI · print", scale: 300 / 72 },
] as const;

export default function PdfToImages() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState("1");
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [resolution, setResolution] = useState("1");
  const [quality, setQuality] = useState(0.85);
  const [background, setBackground] = useState("#ffffff");
  const [prefix, setPrefix] = useState("");
  const [outputs, setOutputs] = useState<ImageOutput[]>([]);
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const [zipName, setZipName] = useState("");
  const [busy, setBusy] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const zipWorkerRef = useRef<Worker | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);
  const zipUrlRef = useRef<string | null>(null);
  const runRef = useRef(0);
  const mountedRef = useRef(false);
  const pagesTouchedRef = useRef(false);
  const preview = usePdfDocument(file);

  useEffect(() => {
    if (file && preview.pageCount > 0 && !pagesTouchedRef.current) setPages(preview.pageCount > PDF_IMAGE_LIMITS.pagesPerExport ? `1-${PDF_IMAGE_LIMITS.pagesPerExport}` : `1-${preview.pageCount}`);
  }, [file, preview.pageCount]);

  const clearOutputs = () => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
    if (zipUrlRef.current) URL.revokeObjectURL(zipUrlRef.current);
    zipUrlRef.current = null; setZipUrl(null); setZipName(""); setOutputs([]);
  };

  const selectFile = async (selected: File | undefined) => {
    if (!selected || busy || zipBusy) return;
    clearOutputs(); setError(""); setFile(null); pagesTouchedRef.current = false; setPages("1");
    try { checkInputLimits(selected.size); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "This PDF does not meet the input limits."); return; }
    try {
      const signature = new Uint8Array(await selected.slice(0, 1024).arrayBuffer());
      if (!checkPdfHeader(signature)) { setError("This file does not have a PDF signature."); return; }
      setFile(selected);
      setPrefix(safeFileStem(selected.name));
    } catch { setError("Unable to read the selected file."); }
  };

  const selected = (() => {
    if (!file || preview.pageCount < 1) return [] as number[];
    try { return selectedImagePages(pages, preview.pageCount); } catch { return [] as number[]; }
  })();
  const selectionError = (() => {
    if (!file || preview.pageCount < 1 || !pages.trim()) return pages.trim() ? "" : "Select at least one page.";
    try { selectedImagePages(pages, preview.pageCount); return ""; }
    catch (reason) { return reason instanceof Error ? reason.message : "That page selection is not valid."; }
  })();
  const scale = RESOLUTIONS.find((option) => option.value === resolution)?.scale ?? 1;

  const togglePage = (page: number) => {
    if (busy || zipBusy) return;
    pagesTouchedRef.current = true;
    const next = selected.includes(page) ? selected.filter((value) => value !== page) : [...selected, page].sort((left, right) => left - right);
    if (next.length > PDF_IMAGE_LIMITS.pagesPerExport) { setError(`Choose no more than ${PDF_IMAGE_LIMITS.pagesPerExport} pages per export.`); return; }
    setError("");
    setPages(formatSelectedPages(next));
  };

  const selectAll = () => {
    if (!preview.pageCount) return;
    pagesTouchedRef.current = true;
    setPages(`1-${preview.pageCount}`);
    if (preview.pageCount > PDF_IMAGE_LIMITS.pagesPerExport) setError(`All ${preview.pageCount} pages are selected, but one export is limited to ${PDF_IMAGE_LIMITS.pagesPerExport} pages. Narrow the range or export in batches.`);
    else setError("");
  };

  const exportImages = async () => {
    if (!file) { setError("Choose a PDF first."); return; }
    clearOutputs(); setError(""); setProgress(null); setBusy(true);
    const run = ++runRef.current;
    let data: Uint8Array | null = null;
    try {
      const buffer = await file.arrayBuffer();
      if (run !== runRef.current) { new Uint8Array(buffer).fill(0); return; }
      data = new Uint8Array(buffer);
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const loadingTask = pdfjs.getDocument({ data });
      loadingTaskRef.current = loadingTask;
      let document: Awaited<typeof loadingTask.promise>;
      try { document = await loadingTask.promise; }
      catch { throw new Error("This PDF could not be opened. It may be corrupt, encrypted, or unsupported."); }
      if (document.numPages < 1 || document.numPages > PDF_LIMITS.pages) throw new Error(`The PDF must contain 1-${PDF_LIMITS.pages} pages.`);
      const requested = selectedImagePages(pages, document.numPages);
      let totalPixels = 0;
      let totalBytes = 0;
      const ready: Omit<ImageOutput, "url">[] = [];
      setProgress({ done: 0, total: requested.length });
      for (let index = 0; index < requested.length; index += 1) {
        if (run !== runRef.current) throw new DOMException("Cancelled", "AbortError");
        const page = await document.getPage(requested[index]);
        const viewport = page.getViewport({ scale });
        const pixels = assertImageWorkBounds(viewport.width, viewport.height, totalPixels);
        totalPixels += pixels;
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("This browser could not create an image canvas.");
        try {
          context.fillStyle = background;
          context.fillRect(0, 0, canvas.width, canvas.height);
          const task = page.render({ canvas, canvasContext: context, viewport, background });
          renderTaskRef.current = task;
          await task.promise;
          renderTaskRef.current = null;
          if (run !== runRef.current) throw new DOMException("Cancelled", "AbortError");
          const mime = format === "png" ? "image/png" : "image/jpeg";
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("The rendered page could not be encoded.")), mime, format === "jpeg" ? quality : undefined));
          const bytes = new Uint8Array(await blob.arrayBuffer());
          validateRenderedImage(bytes, format);
          const bitmap = await createImageBitmap(blob);
          const width = bitmap.width; const height = bitmap.height;
          bitmap.close(); bytes.fill(0);
          if (width !== Math.ceil(viewport.width) || height !== Math.ceil(viewport.height)) throw new Error("A rendered image did not match the requested page dimensions and was discarded.");
          totalBytes += blob.size;
          if (blob.size > 15 * 1024 * 1024 || totalBytes > PDF_IMAGE_LIMITS.totalBytes) throw new Error("Rendered images exceed the per-file or 50 MB combined output limit. Select fewer pages or lower the resolution.");
          const extension = format === "png" ? "png" : "jpg";
          ready.push({ name: `${safeFileStem(prefix || file.name)}-page-${String(requested[index]).padStart(4, "0")}.${extension}`, blob, width, height });
          setProgress({ done: index + 1, total: requested.length });
          page.cleanup();
        } finally {
          renderTaskRef.current = null;
          canvas.width = 0; canvas.height = 0;
          page.cleanup();
        }
      }
      if (run !== runRef.current) throw new DOMException("Cancelled", "AbortError");
      const completed = ready.map((output) => {
        const url = URL.createObjectURL(output.blob); urlsRef.current.push(url);
        return { ...output, url };
      });
      if (mountedRef.current && run === runRef.current) setOutputs(completed);
    } catch (reason) {
      clearOutputs();
      if (mountedRef.current && run === runRef.current && !(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "The PDF pages could not be rendered.");
    } finally {
      if (data?.byteLength) data.fill(0);
      if (loadingTaskRef.current) { const task = loadingTaskRef.current; loadingTaskRef.current = null; try { await task.destroy(); } catch { /* already destroyed */ } }
      if (mountedRef.current && run === runRef.current) { setBusy(false); setProgress(null); }
    }
  };

  const makeZip = async () => {
    if (!outputs.length || zipBusy) return;
    if (zipUrlRef.current) { URL.revokeObjectURL(zipUrlRef.current); zipUrlRef.current = null; setZipUrl(null); }
    setError(""); setZipBusy(true);
    const run = ++runRef.current;
    try {
      const files = await Promise.all(outputs.map(async ({ name, blob }) => ({ name, bytes: await blob.arrayBuffer() })));
      if (run !== runRef.current) { files.forEach(({ bytes }) => new Uint8Array(bytes).fill(0)); return; }
      const worker = new Worker(new URL("@/workers/zip-images.worker.ts", import.meta.url), { type: "module" });
      zipWorkerRef.current = worker;
      worker.onmessage = (event: MessageEvent<ZipReply>) => {
        worker.terminate(); zipWorkerRef.current = null; setZipBusy(false);
        if (!mountedRef.current || run !== runRef.current) { if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0); return; }
        if (!event.data.ok || !event.data.bytes) { setError(event.data.error ?? "The ZIP could not be created."); return; }
        if (event.data.bytes.byteLength > PDF_IMAGE_LIMITS.totalBytes + 1024 * 1024) { new Uint8Array(event.data.bytes).fill(0); setError("The ZIP exceeds the 51 MB archive limit."); return; }
        const url = URL.createObjectURL(new Blob([event.data.bytes], { type: "application/zip" }));
        zipUrlRef.current = url; setZipUrl(url); setZipName(`${safeFileStem(prefix || file?.name || "document")}-pages.zip`);
        new Uint8Array(event.data.bytes).fill(0);
      };
      worker.onerror = () => { worker.terminate(); zipWorkerRef.current = null; if (mountedRef.current && run === runRef.current) { setZipBusy(false); setError("ZIP creation stopped unexpectedly."); } };
      worker.postMessage({ files }, files.map(({ bytes }) => bytes));
    } catch { if (mountedRef.current && run === runRef.current) { setZipBusy(false); setError("Unable to prepare the image archive."); } }
  };

  const cancel = () => {
    runRef.current += 1;
    renderTaskRef.current?.cancel(); renderTaskRef.current = null;
    if (loadingTaskRef.current) { const task = loadingTaskRef.current; loadingTaskRef.current = null; void task.destroy(); }
    zipWorkerRef.current?.terminate(); zipWorkerRef.current = null;
    clearOutputs(); setBusy(false); setZipBusy(false); setProgress(null); setError("Processing cancelled. Temporary browser data was released.");
  };

  const reset = () => {
    if (busy || zipBusy) return;
    clearOutputs();
    setFile(null);
    setPages("1");
    pagesTouchedRef.current = false;
    setPrefix("");
    setError("");
    setProgress(null);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false; runRef.current += 1;
      renderTaskRef.current?.cancel(); zipWorkerRef.current?.terminate();
      if (loadingTaskRef.current) void loadingTaskRef.current.destroy();
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url)); urlsRef.current = [];
      if (zipUrlRef.current) URL.revokeObjectURL(zipUrlRef.current); zipUrlRef.current = null;
    };
  }, []);

  return <section className="merge-panel" aria-labelledby="pdf-images-heading">
    <h2 id="pdf-images-heading">Convert PDF pages to images on this device</h2>
    <p>Render selected pages as PNG or JPG at screen, draft or print resolution. Page thumbnails show the rotation PDF.js will render, and every image is decoded and dimension-checked before a download is shown.</p>
    <div className="privacy-note">Limits: {PDF_LIMITS.perFileBytes / 1024 / 1024} MB input, {PDF_LIMITS.pages} PDF pages, {PDF_IMAGE_LIMITS.pagesPerExport} output pages, 12 megapixels per page, 200 megapixels total and 50 MB combined image output. Rendering is sequential to bound memory; canvases and PDF.js workers are released after the run.</div>
    <label className="file-picker">Choose a PDF<input ref={inputRef} type="file" accept="application/pdf,.pdf" disabled={busy || zipBusy} onChange={(event) => { void selectFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label>
    <div
      className={`drop-zone${dragActive ? " drop-active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => { if (!busy && !zipBusy) inputRef.current?.click(); }}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!busy && !zipBusy) inputRef.current?.click(); } }}
      onDragEnter={(event) => { event.preventDefault(); if (!busy && !zipBusy) setDragActive(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
      onDrop={(event) => { event.preventDefault(); setDragActive(false); if (!busy && !zipBusy) void selectFile(event.dataTransfer.files?.[0]); }}
    >Drop a PDF here, or use the file picker above.</div>
    {preview.error && <p role="alert" className="route-note">{preview.error}</p>}
    {file && <div className="office-convert__file" role="status"><strong>{file.name}</strong><span>{formatBytes(file.size)}</span>{preview.pageCount > 0 && <span>{preview.pageCount} page(s)</span>}</div>}
    {file && preview.pageCount > 0 && <PdfPageGrid
      document={preview.document}
      pageCount={preview.pageCount}
      selected={new Set(selected)}
      mode="toggle"
      label="Page selection"
      onToggle={togglePage}
      onSelectAll={selectAll}
      onClearSelection={() => { pagesTouchedRef.current = true; setPages(""); }}
    />}
    {file && <fieldset className="conversion-options">
      <legend>Image settings</legend>
      <label htmlFor="image-pages">Pages to export
        <input id="image-pages" className="split-range-input" value={pages} disabled={busy || zipBusy} onChange={(event) => { pagesTouchedRef.current = true; setPages(event.target.value); }} aria-describedby="image-pages-help" aria-invalid={Boolean(selectionError)}/>
        <span id="image-pages-help" className="route-note">Use pages or ranges, such as 1-3, 5. Click thumbnails to toggle pages. Ranges keep their entered order.</span>
      </label>
      {selectionError && <p className="conversion-field-error" role="alert">{selectionError}</p>}
      <label htmlFor="image-format">Image format
        <select id="image-format" className="split-range-input" value={format} disabled={busy || zipBusy} onChange={(event) => setFormat(event.target.value as "png" | "jpeg")}><option value="png">PNG</option><option value="jpeg">JPG</option></select>
      </label>
      <label htmlFor="image-resolution">Resolution
        <select id="image-resolution" className="split-range-input" value={resolution} disabled={busy || zipBusy} onChange={(event) => setResolution(event.target.value)}>{RESOLUTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      </label>
      {format === "jpeg" && <label htmlFor="image-quality">JPG quality
        <select id="image-quality" className="split-range-input" value={quality} disabled={busy || zipBusy} onChange={(event) => setQuality(Number(event.target.value))}><option value={0.7}>70%</option><option value={0.85}>85%</option><option value={0.95}>95%</option></select>
      </label>}
      <label htmlFor="image-background">Background colour
        <input id="image-background" type="color" value={background} disabled={busy || zipBusy} onChange={(event) => setBackground(event.target.value)} />
      </label>
      <label htmlFor="image-prefix">Output filename prefix
        <input id="image-prefix" value={prefix} disabled={busy || zipBusy} onChange={(event) => setPrefix(event.target.value)} />
      </label>
    </fieldset>}
    <div className="merge-actions"><button type="button" className="hero-cta" disabled={!file || busy || zipBusy} onClick={() => void exportImages()}>{busy ? "Rendering pages…" : "Convert to images"}</button>{(busy || zipBusy) && <button type="button" onClick={cancel}>Cancel</button>}{outputs.length > 0 && <button type="button" onClick={() => void makeZip()} disabled={zipBusy}>{zipBusy ? "Creating ZIP…" : "Download all as ZIP"}</button>}{file && !busy && <button type="button" onClick={reset}>Start over</button>}</div>
    {progress && <p role="status" aria-live="polite">Rendered {progress.done} of {progress.total} selected pages at {RESOLUTIONS.find((option) => option.value === resolution)?.label ?? "the selected resolution"}.</p>}{zipBusy && <p role="status" aria-live="polite">Creating a ZIP archive from the validated images.</p>}{error && <p role="alert" className="merge-error">{error}</p>}
    {outputs.length > 0 && <div role="status" className="merge-success"><p>Validated {outputs.length} image(s) · {formatBytes(outputs.reduce((sum, image) => sum + image.blob.size, 0))}</p><ul>{outputs.map((output) => <li key={output.url}><a href={output.url} download={output.name}>{output.name} · {output.width} × {output.height} · {formatBytes(output.blob.size)}</a></li>)}</ul>{zipUrl && <a href={zipUrl} download={zipName}>Download ZIP archive</a>}</div>}
  </section>;
}
