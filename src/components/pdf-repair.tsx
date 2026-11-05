"use client";

import { useEffect, useRef, useState } from "react";
import { PDF_LIMITS, checkPdfHeader } from "@/lib/pdf-limits";
import type { RepairReport } from "@/lib/pdf-repair";
import { formatBytes } from "@/lib/pdf-optimize";

type Reply = { ok: boolean; bytes?: ArrayBuffer; report?: RepairReport; error?: string };
type RepairResult = { url: string; name: string; report: RepairReport };

export default function PdfRepair() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RepairResult | null>(null);
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

  const repair = async () => {
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
        if (!event.data.ok || !event.data.bytes || !event.data.report) { setError(event.data.error ?? "The repair could not be completed."); return; }
        const blob = new Blob([event.data.bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob); urlRef.current = url;
        new Uint8Array(event.data.bytes).fill(0);
        const stem = file.name.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 100) || "document";
        setResult({ url, name: `${stem}-repaired.pdf`, report: event.data.report });
      };
      worker.onerror = () => { worker.terminate(); workerRef.current = null; if (mountedRef.current && task === taskRef.current) { setBusy(false); setError("PDF processing stopped unexpectedly. Try a different file."); } };
      worker.postMessage({ mode: "repair", file: buffer }, [buffer]);
    } catch {
      if (mountedRef.current && task === taskRef.current) { setBusy(false); setError("Unable to read the selected file."); }
    }
  };
  const cancel = () => { taskRef.current += 1; workerRef.current?.terminate(); workerRef.current = null; setBusy(false); setError("Repair cancelled. Temporary in-memory data was released."); };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; taskRef.current += 1; workerRef.current?.terminate(); workerRef.current = null; if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; };
  }, []);

  const report = result?.report;

  return <section className="merge-panel" aria-labelledby="repair-heading">
    <h2 id="repair-heading">Repair PDF on this device</h2>
    <p>Rebuilds the file structure: a fresh cross-reference, trailer and page tree are written around the pages that can still be read. Nothing is uploaded.</p>
    <div className="privacy-note">Limit: one PDF up to {PDF_LIMITS.perFileBytes / 1024 / 1024} MB and {PDF_LIMITS.pages} pages. Repair fixes structure, not content: text that is already destroyed inside a page stream cannot be recreated.</div>
    <label className="file-picker">Choose a PDF<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => { void selectFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label>
    {file && <p className="pdf-file-line"><strong>{file.name}</strong> · {formatBytes(file.size)}</p>}
    <div className="merge-actions">
      <button type="button" className="hero-cta" disabled={busy || !file} onClick={() => void repair()}>{busy ? "Rebuilding structure…" : "Repair PDF"}</button>
      {busy && <button type="button" onClick={cancel}>Cancel</button>}
    </div>
    {busy && <p role="status" aria-live="polite">Rebuilding the document structure in a dedicated browser worker.</p>}
    {error && <p role="alert" className="merge-error">{error}</p>}
    {result && report && <div role="status" className="merge-success pdf-result">
      <p>Structure rebuilt and validated · {report.pagesRecovered} of {report.pagesTotal} pages recovered</p>
      <a href={result.url} download={result.name}>Download repaired PDF</a>
      <dl className="pdf-report">
        <dt>Pages recovered</dt><dd>{report.pagesRecovered} of {report.pagesTotal}{report.droppedPages.length ? ` (left out: ${report.droppedPages.join(", ")})` : ""}</dd>
        <dt>Structure issues found</dt><dd>{report.issues.length ? report.issues.map((issue) => issue.label).join(" ") : "None detected — the file was rebuilt as a clean copy."}</dd>
        <dt>Document information</dt><dd>{report.metadataRestored.length ? `Restored: ${report.metadataRestored.join(", ")}.` : "No readable title or author was present."}</dd>
        <dt>Annotations kept</dt><dd>{report.annotationsPreserved}</dd>
        <dt>Size</dt><dd>{formatBytes(report.inputBytes)} → {formatBytes(report.outputBytes)}</dd>
        <dt>Output check</dt><dd>{report.verified ? "The repaired file re-opened with the same page count and page sizes." : "Not verified."}</dd>
      </dl>
      {report.notes.map((note) => <p className="pdf-note" key={note}>{note}</p>)}
    </div>}
  </section>;
}
