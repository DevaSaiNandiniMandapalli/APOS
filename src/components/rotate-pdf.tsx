"use client";

import { useEffect, useRef, useState } from "react";
import { PDF_LIMITS, checkPdfHeader } from "@/lib/pdf-limits";
import { parsePageRanges } from "@/lib/split-pdf";

type Reply = { ok: boolean; bytes?: ArrayBuffer; pageCount?: number; error?: string };
export default function RotatePdf() {
  const [file, setFile] = useState<File | null>(null);
  const [angle, setAngle] = useState<90 | 180 | 270>(90);
  const [rotateAll, setRotateAll] = useState(true);
  const [rangeText, setRangeText] = useState("");
  const [result, setResult] = useState<{ url: string; name: string; pages: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const workerRef = useRef<Worker | null>(null);
  const urlRef = useRef<string | null>(null);
  const taskRef = useRef(0);
  const mountedRef = useRef(false);

  const clearResult = () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; setResult(null); };
  const selectFile = async (selected: File | undefined) => {
    if (busy || !selected) return;
    clearResult(); setError(""); setFile(null);
    if (!selected.size) { setError("The selected file is empty."); return; }
    if (selected.size > PDF_LIMITS.perFileBytes) { setError("The PDF exceeds the 50 MB file limit."); return; }
    try {
      const head = new Uint8Array(await selected.slice(0, 1024).arrayBuffer());
      if (!checkPdfHeader(head)) { setError("This file does not have a PDF signature."); return; }
      setFile(selected);
    } catch { setError("Unable to read the selected file."); }
  };
  const rotate = async () => {
    if (!file) { setError("Choose a PDF first."); return; }
    let ranges;
    try { ranges = rotateAll ? [] : parsePageRanges(rangeText, PDF_LIMITS.pages); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Enter valid page ranges."); return; }
    clearResult(); setError(""); setBusy(true);
    const task = ++taskRef.current;
    try {
      const buffer = await file.arrayBuffer();
      if (task !== taskRef.current) { new Uint8Array(buffer).fill(0); return; }
      const worker = new Worker(new URL("@/workers/rotate-pdf.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<Reply>) => {
        worker.terminate(); workerRef.current = null;
        if (!mountedRef.current || task !== taskRef.current) { if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0); return; }
        setBusy(false);
        if (!event.data.ok || !event.data.bytes || !event.data.pageCount) { setError(event.data.error ?? "The rotation failed."); return; }
        const blob = new Blob([event.data.bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob); urlRef.current = url;
        new Uint8Array(event.data.bytes).fill(0);
        const stem = file.name.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 100) || "document";
        setResult({ url, name: `${stem}-rotated.pdf`, pages: event.data.pageCount });
      };
      worker.onerror = () => { worker.terminate(); workerRef.current = null; if (mountedRef.current && task === taskRef.current) { setBusy(false); setError("PDF processing stopped unexpectedly. Try a different file."); } };
      worker.postMessage({ file: buffer, ranges, angle, rotateAll }, [buffer]);
    } catch {
      if (mountedRef.current && task === taskRef.current) { setBusy(false); setError("Unable to read the selected file."); }
    }
  };
  const cancel = () => { taskRef.current += 1; workerRef.current?.terminate(); workerRef.current = null; setBusy(false); setError("Rotation cancelled. Temporary in-memory data was released."); };
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; taskRef.current += 1; workerRef.current?.terminate(); workerRef.current = null; if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; };
  }, []);

  return <section className="merge-panel" aria-labelledby="rotate-heading">
    <h2 id="rotate-heading">Rotate PDF on this device</h2>
    <p>Rotate every page or selected pages. Page content and document order are preserved.</p>
    <div className="privacy-note">Limit: one PDF up to {PDF_LIMITS.perFileBytes / 1024 / 1024} MB and {PDF_LIMITS.pages} pages. Page thumbnails are not shown; specify page numbers or ranges directly.</div>
    <label className="file-picker">Choose a PDF<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => { void selectFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label>
    {file && <div className="split-settings"><p><strong>{file.name}</strong></p><label htmlFor="rotate-angle">Rotation</label><select id="rotate-angle" className="split-range-input" value={angle} disabled={busy} onChange={(event) => setAngle(Number(event.target.value) as 90 | 180 | 270)}><option value={90}>90° clockwise</option><option value={180}>180°</option><option value={270}>270° clockwise</option></select><label className="rotate-all-toggle"><input type="checkbox" checked={rotateAll} disabled={busy} onChange={(event) => setRotateAll(event.target.checked)}/> Rotate all pages</label>{!rotateAll && <><label htmlFor="rotate-ranges">Pages to rotate</label><input id="rotate-ranges" className="split-range-input" value={rangeText} disabled={busy} onChange={(event) => setRangeText(event.target.value)} aria-describedby="rotate-range-help"/><p id="rotate-range-help" className="route-note">Comma-separated pages or ranges, such as 1-3, 5. Page bounds are checked in the worker.</p></>}</div>}
    <div className="merge-actions"><button type="button" className="hero-cta" disabled={busy || !file} onClick={() => void rotate()}>{busy ? "Rotating…" : "Rotate PDF"}</button>{busy && <button type="button" onClick={cancel}>Cancel</button>}</div>
    {busy && <p role="status" aria-live="polite">Processing in a dedicated browser worker. Progress is indeterminate.</p>}{error && <p role="alert" className="merge-error">{error}</p>}
    {result && <div role="status" className="merge-success"><p>Validated PDF ready · {result.pages} pages</p><a href={result.url} download={result.name}>Download rotated PDF</a></div>}
  </section>;
}
