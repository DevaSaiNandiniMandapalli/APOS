"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import { checkPdfHeader, PDF_LIMITS } from "@/lib/pdf-limits";
import { assertImageWorkBounds, checkInputLimits, PDF_IMAGE_LIMITS, safeFileStem, selectedImagePages, validateRenderedImage } from "@/lib/pdf-images";

type ImageOutput = { name: string; url: string; blob: Blob; width: number; height: number };
type ZipReply = { ok: boolean; bytes?: ArrayBuffer; error?: string };
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

export default function PdfToImages() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState("1");
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [scale, setScale] = useState(1);
  const [quality, setQuality] = useState(0.85);
  const [outputs, setOutputs] = useState<ImageOutput[]>([]);
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const [zipName, setZipName] = useState("");
  const [busy, setBusy] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const zipWorkerRef = useRef<Worker | null>(null);
  const urlsRef = useRef<string[]>([]);
  const zipUrlRef = useRef<string | null>(null);
  const runRef = useRef(0);
  const mountedRef = useRef(false);

  const clearOutputs = () => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
    if (zipUrlRef.current) URL.revokeObjectURL(zipUrlRef.current);
    zipUrlRef.current = null; setZipUrl(null); setZipName(""); setOutputs([]);
  };

  const selectFile = async (selected: File | undefined) => {
    if (!selected || busy || zipBusy) return;
    clearOutputs(); setError(""); setFile(null);
    try { checkInputLimits(selected.size); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "This PDF does not meet the input limits."); return; }
    try {
      const signature = new Uint8Array(await selected.slice(0, 1024).arrayBuffer());
      if (!checkPdfHeader(signature)) { setError("This file does not have a PDF signature."); return; }
      setFile(selected); setPages("1");
    } catch { setError("Unable to read the selected file."); }
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
      const selected = selectedImagePages(pages, document.numPages);
      let totalPixels = 0;
      let totalBytes = 0;
      const ready: Omit<ImageOutput, "url">[] = [];
      setProgress({ done: 0, total: selected.length });
      for (let index = 0; index < selected.length; index += 1) {
        if (run !== runRef.current) throw new DOMException("Cancelled", "AbortError");
        const page = await document.getPage(selected[index]);
        const viewport = page.getViewport({ scale });
        const pixels = assertImageWorkBounds(viewport.width, viewport.height, totalPixels);
        totalPixels += pixels;
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d", { alpha: format === "png" });
        if (!context) throw new Error("This browser could not create an image canvas.");
        try {
          const task = page.render({ canvas, canvasContext: context, viewport, background: format === "jpeg" ? "#ffffff" : undefined });
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
          totalBytes += blob.size;
          if (blob.size > 15 * 1024 * 1024 || totalBytes > PDF_IMAGE_LIMITS.totalBytes) throw new Error("Rendered images exceed the per-file or 25 MB combined output limit. Select fewer pages or lower the resolution.");
          const extension = format === "png" ? "png" : "jpg";
          ready.push({ name: `${safeFileStem(file.name)}-page-${String(selected[index]).padStart(4, "0")}.${extension}`, blob, width, height });
          setProgress({ done: index + 1, total: selected.length });
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
      // PDF.js transfers ownership of its input buffer to its worker in some browsers.
      // A detached Uint8Array cannot be filled; the worker owns/reclaims that buffer.
      if (data?.byteLength) data.fill(0);
      if (loadingTaskRef.current) { const task = loadingTaskRef.current; loadingTaskRef.current = null; try { await task.destroy(); } catch { /* PDF.js may already have destroyed a cancelled task. */ } }
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
        if (event.data.bytes.byteLength > PDF_IMAGE_LIMITS.totalBytes + 1024 * 1024) { new Uint8Array(event.data.bytes).fill(0); setError("The ZIP exceeds the 26 MB archive limit."); return; }
        const url = URL.createObjectURL(new Blob([event.data.bytes], { type: "application/zip" }));
        zipUrlRef.current = url; setZipUrl(url); setZipName(`${safeFileStem(file?.name ?? "document")}-pages.zip`);
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
    <p>Render selected pages as PNG or JPG. Each image is validated before downloads are shown.</p>
    <div className="privacy-note">Limits: {PDF_LIMITS.perFileBytes / 1024 / 1024} MB input, {PDF_LIMITS.pages} PDF pages, {PDF_IMAGE_LIMITS.pagesPerExport} output pages, 12 megapixels per page and 25 MB combined image output. Rendering is sequential to bound memory.</div>
    <label className="file-picker">Choose a PDF<input type="file" accept="application/pdf,.pdf" disabled={busy || zipBusy} onChange={(event) => { void selectFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label>
    {file && <div className="split-settings"><p><strong>{file.name}</strong> · {formatBytes(file.size)}</p><label htmlFor="image-pages">Pages to export</label><input id="image-pages" className="split-range-input" value={pages} disabled={busy || zipBusy} onChange={(event) => setPages(event.target.value)} aria-describedby="image-pages-help"/><p id="image-pages-help" className="route-note">Enter pages or ranges, such as 1-3, 5. Ranges are kept in order and cannot overlap.</p><label htmlFor="image-format">Image format</label><select id="image-format" className="split-range-input" value={format} disabled={busy || zipBusy} onChange={(event) => setFormat(event.target.value as "png" | "jpeg")}><option value="png">PNG</option><option value="jpeg">JPG</option></select><label htmlFor="image-resolution">Resolution</label><select id="image-resolution" className="split-range-input" value={scale} disabled={busy || zipBusy} onChange={(event) => setScale(Number(event.target.value))}><option value={1}>72 DPI · 1×</option><option value={1.5}>108 DPI · 1.5×</option><option value={2}>144 DPI · 2×</option></select>{format === "jpeg" && <><label htmlFor="image-quality">JPG quality</label><select id="image-quality" className="split-range-input" value={quality} disabled={busy || zipBusy} onChange={(event) => setQuality(Number(event.target.value))}><option value={0.7}>70%</option><option value={0.85}>85%</option><option value={0.95}>95%</option></select></>}</div>}
    <div className="merge-actions"><button type="button" className="hero-cta" disabled={!file || busy || zipBusy} onClick={() => void exportImages()}>{busy ? "Rendering pages…" : "Convert to images"}</button>{(busy || zipBusy) && <button type="button" onClick={cancel}>Cancel</button>}{outputs.length > 0 && <button type="button" onClick={() => void makeZip()} disabled={zipBusy}>{zipBusy ? "Creating ZIP…" : "Download all as ZIP"}</button>}</div>
    {progress && <p role="status" aria-live="polite">Rendered {progress.done} of {progress.total} selected pages.</p>}{zipBusy && <p role="status" aria-live="polite">Creating a ZIP archive from the validated images.</p>}{error && <p role="alert" className="merge-error">{error}</p>}
    {outputs.length > 0 && <div role="status" className="merge-success"><p>Validated {outputs.length} image(s) · {formatBytes(outputs.reduce((sum, image) => sum + image.blob.size, 0))}</p><ul>{outputs.map((output) => <li key={output.url}><a href={output.url} download={output.name}>{output.name} · {output.width} × {output.height} · {formatBytes(output.blob.size)}</a></li>)}</ul>{zipUrl && <a href={zipUrl} download={zipName}>Download ZIP archive</a>}</div>}
  </section>;
}
