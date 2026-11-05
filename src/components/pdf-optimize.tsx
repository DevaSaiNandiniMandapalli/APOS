"use client";

import { useEffect, useRef, useState } from "react";
import { PDF_LIMITS, checkPdfHeader } from "@/lib/pdf-limits";
import { DEFAULT_OPTIMIZE_OPTIONS, formatBytes, optimizeSummary, type OptimizeOptions, type OptimizeReport } from "@/lib/pdf-optimize";

type Reply = { ok: boolean; bytes?: ArrayBuffer; report?: OptimizeReport; error?: string };
type OptimizeResult = { url: string; name: string; report: OptimizeReport };

export default function PdfOptimize() {
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<OptimizeOptions>(DEFAULT_OPTIMIZE_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const urlRef = useRef<string | null>(null);
  const taskRef = useRef(0);
  const mountedRef = useRef(false);

  const clearResult = () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; setResult(null); };
  const selectFile = async (selected: File | undefined) => {
    if (!selected || busy) return;
    clearResult(); setError(""); setFile(null);
    if (!selected.size) { setError("The selected file is empty."); return; }
    if (selected.size > PDF_LIMITS.perFileBytes) { setError("The PDF exceeds the 50 MB file limit."); return; }
    try {
      const head = new Uint8Array(await selected.slice(0, 1024).arrayBuffer());
      if (!checkPdfHeader(head)) { setError("This file does not have a PDF signature."); return; }
      setFile(selected);
    } catch { setError("Unable to read the selected file."); }
  };

  const optimize = async () => {
    if (!file) { setError("Choose a PDF first."); return; }
    clearResult(); setError(""); setBusy(true);
    const task = ++taskRef.current;
    try {
      const buffer = await file.arrayBuffer();
      if (task !== taskRef.current) { new Uint8Array(buffer).fill(0); return; }
      const worker = new Worker(new URL("@/workers/pdf-service.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<Reply>) => {
        worker.terminate(); workerRef.current = null;
        if (!mountedRef.current || task !== taskRef.current) { if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0); return; }
        setBusy(false);
        if (!event.data.ok || !event.data.bytes || !event.data.report) { setError(event.data.error ?? "The optimization could not be completed."); return; }
        const blob = new Blob([event.data.bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob); urlRef.current = url;
        new Uint8Array(event.data.bytes).fill(0);
        const stem = file.name.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 100) || "document";
        setResult({ url, name: `${stem}-optimized.pdf`, report: event.data.report });
      };
      worker.onerror = () => { worker.terminate(); workerRef.current = null; if (mountedRef.current && task === taskRef.current) { setBusy(false); setError("PDF processing stopped unexpectedly. Try a different file."); } };
      worker.postMessage({ mode: "optimize", file: buffer, options }, [buffer]);
    } catch {
      if (mountedRef.current && task === taskRef.current) { setBusy(false); setError("Unable to read the selected file."); }
    }
  };
  const cancel = () => { taskRef.current += 1; workerRef.current?.terminate(); workerRef.current = null; setBusy(false); setError("Optimization cancelled. Temporary in-memory data was released."); };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; taskRef.current += 1; workerRef.current?.terminate(); workerRef.current = null; if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; };
  }, []);

  const report = result?.report;

  return <section className="merge-panel" aria-labelledby="optimize-heading">
    <h2 id="optimize-heading">Optimize PDF on this device</h2>
    <p>Rewrites the PDF structure, then measures the result. Optional clean-ups only run when you ask for them.</p>
    <div className="privacy-note">Limit: one PDF up to {PDF_LIMITS.perFileBytes / 1024 / 1024} MB and {PDF_LIMITS.pages} pages. Compression cannot shrink images that are already compact; the measured report shows exactly what changed.</div>
    <label className="file-picker">Choose a PDF<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => { void selectFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label>
    {file && <p className="pdf-file-line"><strong>{file.name}</strong> · {formatBytes(file.size)}</p>}
    <fieldset className="pdf-options">
      <legend>What should be optimized</legend>
      <label><input type="checkbox" checked={options.compressStreams} disabled={busy} onChange={(event) => setOptions({ ...options, compressStreams: event.target.checked })}/> Compress objects into object streams</label>
      <label><input type="checkbox" checked={options.removeMetadata} disabled={busy} onChange={(event) => setOptions({ ...options, removeMetadata: event.target.checked })}/> Remove document information (title, author, subject, keywords, creator)</label>
      <label><input type="checkbox" checked={options.flattenForms} disabled={busy} onChange={(event) => setOptions({ ...options, flattenForms: event.target.checked })}/> Flatten form fields so they can no longer be edited</label>
    </fieldset>
    <div className="merge-actions">
      <button type="button" className="hero-cta" disabled={busy || !file} onClick={() => void optimize()}>{busy ? "Optimizing…" : "Optimize PDF"}</button>
      {busy && <button type="button" onClick={cancel}>Cancel</button>}
    </div>
    {busy && <p role="status" aria-live="polite">Rewriting the PDF in a dedicated browser worker.</p>}
    {error && <p role="alert" className="merge-error">{error}</p>}
    {result && report && <div role="status" className="merge-success pdf-result">
      <p>Optimized and validated · {optimizeSummary(report)}</p>
      <a href={result.url} download={result.name}>Download optimized PDF</a>
      <dl className="pdf-report">
        <dt>Size</dt><dd>{formatBytes(report.inputBytes)} → {formatBytes(report.outputBytes)} ({report.savedBytes >= 0 ? `${report.savedPercent.toFixed(1)}% smaller` : `${Math.abs(report.savedPercent).toFixed(1)}% larger`})</dd>
        <dt>Pages</dt><dd>{report.pageCount} (unchanged, sizes preserved)</dd>
        <dt>Document information</dt><dd>{report.metadataCleared.length ? `Removed: ${report.metadataCleared.join(", ")}.` : "Kept as it was."}</dd>
        <dt>Form fields flattened</dt><dd>{report.fieldsFlattened}</dd>
        <dt>Output check</dt><dd>{report.verified ? "The optimized file re-opened with the same page count and page sizes." : "Not verified."}</dd>
      </dl>
      {report.notes.map((note) => <p className="pdf-note" key={note}>{note}</p>)}
    </div>}
  </section>;
}
