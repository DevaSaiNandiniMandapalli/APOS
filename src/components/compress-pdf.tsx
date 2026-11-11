"use client";

import { useEffect, useRef, useState } from "react";
import { checkPdfHeader, PDF_LIMITS } from "@/lib/pdf-limits";
import { compressionSizeReport } from "@/lib/compress-pdf";
import { COMPRESS_LEVELS, compressByRendering, type CompressLevel } from "@/lib/compress-render";

type Reply = { ok: boolean; bytes?: ArrayBuffer; inputBytes?: number; outputBytes?: number; pageCount?: number; error?: string };
type CompressionResult = { url: string; name: string; inputBytes: number; outputBytes: number; pageCount: number };
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

export default function CompressPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CompressionResult | null>(null);
  const [mode, setMode] = useState<"images" | "structure">("images");
  const [level, setLevel] = useState<CompressLevel>("medium");
  const [targetKb, setTargetKb] = useState("");
  const [pages, setPages] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const resultUrlRef = useRef<string | null>(null);
  const taskRef = useRef(0);
  const mountedRef = useRef(false);

  const clearResult = () => { if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current); resultUrlRef.current = null; setResult(null); };
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
  const compress = async () => {
    if (!file) return;
    clearResult(); setError(""); setBusy(true);
    const task = ++taskRef.current;
    try {
      const buffer = await file.arrayBuffer();
      if (mode === "images") {
        const parsedTarget = Number(targetKb);
        const resultRendered = await compressByRendering(new Uint8Array(buffer), {
          level,
          pages,
          targetKb: Number.isFinite(parsedTarget) && parsedTarget > 0 ? parsedTarget : undefined,
          onProgress: (done, total) => { if (mountedRef.current && task === taskRef.current) setProgress({ done, total }); },
        });
        if (!mountedRef.current || task !== taskRef.current) { resultRendered.bytes.fill(0); return; }
        const blob = new Blob([new Uint8Array(resultRendered.bytes).slice().buffer as ArrayBuffer], { type: "application/pdf" });
        const url = URL.createObjectURL(blob); resultUrlRef.current = url;
        const stem = file.name.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 100) || "document";
        setResult({ url, name: `${stem}-compressed.pdf`, inputBytes: resultRendered.inputBytes, outputBytes: resultRendered.outputBytes, pageCount: resultRendered.pageCount });
        resultRendered.bytes.fill(0);
        setBusy(false); setProgress(null);
        return;
      }
      if (task !== taskRef.current) { new Uint8Array(buffer).fill(0); return; }
      const worker = new Worker(new URL("@/workers/compress-pdf.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<Reply>) => {
        worker.terminate(); workerRef.current = null;
        if (!mountedRef.current || task !== taskRef.current) { if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0); return; }
        setBusy(false);
        if (!event.data.ok || !event.data.bytes || event.data.inputBytes === undefined || event.data.outputBytes === undefined || !event.data.pageCount) {
          setError(event.data.error ?? "Compression could not be completed."); return;
        }
        const blob = new Blob([event.data.bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob); resultUrlRef.current = url;
        new Uint8Array(event.data.bytes).fill(0);
        const stem = file.name.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 100) || "document";
        setResult({ url, name: `${stem}-compressed.pdf`, inputBytes: event.data.inputBytes, outputBytes: event.data.outputBytes, pageCount: event.data.pageCount });
      };
      worker.onerror = () => { worker.terminate(); workerRef.current = null; if (mountedRef.current && task === taskRef.current) { setBusy(false); setError("PDF processing stopped unexpectedly."); } };
      worker.postMessage({ file: buffer }, [buffer]);
    } catch { if (mountedRef.current && task === taskRef.current) { setBusy(false); setError("Unable to read the selected file."); } }
  };
  const cancel = () => { taskRef.current += 1; workerRef.current?.terminate(); workerRef.current = null; setBusy(false); setError("Compression cancelled. Temporary in-memory data was released."); };
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; taskRef.current += 1; workerRef.current?.terminate(); workerRef.current = null; if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current); resultUrlRef.current = null; };
  }, []);

  const report = result ? compressionSizeReport(result.inputBytes, result.outputBytes) : "";

  return <section className="merge-panel" aria-labelledby="compress-heading">
    <h2 id="compress-heading">Compress PDF on this device</h2>
    <p>Choose how hard to compress, optionally name a target size and pick page ranges. Image reduction re-renders the chosen pages at your level, so those pages become pictures; the other pages keep their text.</p>
    <div className="privacy-note">Limit: one PDF up to {PDF_LIMITS.perFileBytes / 1024 / 1024} MB and {PDF_LIMITS.pages} pages. Compression may not reduce every file; actual sizes are always shown.</div>
    <label className="file-picker">Choose a PDF<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => { void selectFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label>
    {file && <div className="split-settings">
      <p><strong>{file.name}</strong> · {formatBytes(file.size)}</p>
      <label htmlFor="compress-mode">Compression method</label>
      <select id="compress-mode" className="split-range-input" value={mode} disabled={busy} onChange={(event) => setMode(event.target.value as "images" | "structure")}>
        <option value="images">Reduce images and re-render pages (strongest)</option>
        <option value="structure">Rewrite structure only (keeps text, smaller gains)</option>
      </select>
      {mode === "images" && <>
        <label htmlFor="compress-level">Compression level</label>
        <select id="compress-level" className="split-range-input" value={level} disabled={busy} onChange={(event) => setLevel(event.target.value as CompressLevel)}>
          {COMPRESS_LEVELS.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.detail}</option>)}
        </select>
        <label htmlFor="compress-target">Target size (KB, optional)</label>
        <input id="compress-target" className="split-range-input" inputMode="numeric" value={targetKb} disabled={busy} placeholder="e.g. 200" onChange={(event) => setTargetKb(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}/>
        <p className="route-note">Leave blank to use the level&apos;s built-in target. APOS lowers the resolution step by step until the file fits.</p>
        <label htmlFor="compress-pages">Pages to re-render</label>
        <input id="compress-pages" className="split-range-input" value={pages} disabled={busy} placeholder="All pages (default)" onChange={(event) => setPages(event.target.value)}/>
        <p className="route-note">Enter page numbers or ranges, such as 1-3, 7. Blank uses every page.</p>
      </>}
    </div>}
    <div className="merge-actions"><button type="button" className="hero-cta" disabled={busy || !file} onClick={() => void compress()}>{busy ? "Compressing…" : "Compress PDF"}</button>{busy && <button type="button" onClick={cancel}>Cancel</button>}</div>
    {busy && <p role="status" aria-live="polite">{progress ? `Re-rendering page ${progress.done} of ${progress.total}…` : "Preparing the document in this browser…"}</p>}{error && <p role="alert" className="merge-error">{error}</p>}
    {result && <div role="status" className="merge-success"><p>{report}</p><p>Input: {formatBytes(result.inputBytes)} · Output: {formatBytes(result.outputBytes)} · {result.pageCount} pages</p><a href={result.url} download={result.name}>Download rewritten PDF</a></div>}
  </section>;
}
