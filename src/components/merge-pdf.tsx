"use client";

import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "@cantoo/pdf-lib";
import { PDF_LIMITS, PdfInputError, checkPdfHeader } from "@/lib/pdf-limits";

type Entry = { id: string; file: File };
type WorkerReply = { ok: boolean; bytes?: ArrayBuffer; pageCount?: number; error?: string };

export default function MergePdf() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string; name: string; pages: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const resultUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const dragIndex = useRef<number | null>(null);
  const taskIdRef = useRef(0);
  const total = entries.reduce((sum, entry) => sum + entry.file.size, 0);

  const clearResult = () => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
    setResult(null);
  };
  const addFiles = async (files: FileList | File[]) => {
    if (busy) return;
    setError(""); clearResult();
    const selected = Array.from(files);
    if (!selected.length) return;
    if (entries.length + selected.length > PDF_LIMITS.fileCount) { setError(`Choose no more than ${PDF_LIMITS.fileCount} files.`); return; }
    if (selected.some((file) => file.size === 0)) { setError("Empty files cannot be merged."); return; }
    if (selected.some((file) => file.size > PDF_LIMITS.perFileBytes) || total + selected.reduce((sum, file) => sum + file.size, 0) > PDF_LIMITS.totalBytes) { setError("A file exceeds the per-file or combined size limit."); return; }
    for (const file of selected) {
      const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
      if (!checkPdfHeader(head)) { setError(`${file.name}: this file does not have a PDF signature.`); return; }
    }
    setEntries((current) => [...current, ...selected.map((file) => ({ id: crypto.randomUUID(), file }))]);
  };
  const remove = (id: string) => { clearResult(); setEntries((current) => current.filter((entry) => entry.id !== id)); };
  const move = (from: number, to: number) => { if (to < 0 || to >= entries.length || to === from) return; setEntries((current) => { const copy = [...current]; const [item] = copy.splice(from, 1); copy.splice(to, 0, item); return copy; }); clearResult(); };
  const cancel = () => { taskIdRef.current += 1; workerRef.current?.terminate(); workerRef.current = null; setBusy(false); setError("Merge cancelled. Temporary in-memory data was released."); };
  const merge = async () => {
    setError(""); clearResult();
    if (entries.length < 2) { setError("Select at least two PDF files."); return; }
    setBusy(true);
    const taskId = ++taskIdRef.current;
    try {
      const buffers = await Promise.all(entries.map(async ({ file }) => file.arrayBuffer()));
      if (taskId !== taskIdRef.current) return;
      const worker = new Worker(new URL("@/workers/merge-pdf.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = async (event: MessageEvent<WorkerReply>) => {
        worker.terminate(); workerRef.current = null;
        if (!mountedRef.current || taskId !== taskIdRef.current) {
          if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0);
          return;
        }
        setBusy(false);
        if (!event.data.ok || !event.data.bytes) { setError(event.data.error ?? "The merge failed."); return; }
        try {
          const verified = await PDFDocument.load(event.data.bytes, { updateMetadata: false });
          if (verified.getPageCount() !== event.data.pageCount || verified.getPageCount() > PDF_LIMITS.pages) throw new Error("Output validation failed.");
          const blob = new Blob([event.data.bytes], { type: "application/pdf" });
          if (!mountedRef.current || taskId !== taskIdRef.current) return;
          const url = URL.createObjectURL(blob);
          resultUrlRef.current = url;
          setResult({ url, name: "merged-document.pdf", pages: verified.getPageCount() });
        } catch { if (mountedRef.current && taskId === taskIdRef.current) setError("The generated PDF failed validation and was discarded."); }
        finally { new Uint8Array(event.data.bytes).fill(0); }
      };
      worker.onerror = () => { worker.terminate(); workerRef.current = null; if (mountedRef.current && taskId === taskIdRef.current) { setBusy(false); setError("PDF processing stopped unexpectedly. Try different files."); } };
      worker.postMessage({ files: buffers }, buffers);
    } catch (reason) { setBusy(false); setError(reason instanceof PdfInputError ? reason.message : "Unable to read the selected files."); }
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      taskIdRef.current += 1;
      workerRef.current?.terminate();
      workerRef.current = null;
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = null;
    };
  }, []);

  return <section className="merge-panel" aria-labelledby="merge-heading"><h2 id="merge-heading">Merge PDFs on this device</h2><p>Your files are read and processed in this browser. They are not sent to APOS servers.</p><div className="privacy-note">Limit: 2–{PDF_LIMITS.fileCount} PDFs, {PDF_LIMITS.perFileBytes / 1024 / 1024} MB per file, {PDF_LIMITS.totalBytes / 1024 / 1024} MB total, and {PDF_LIMITS.pages} pages. Interactive forms, bookmarks, attachments, and source digital signatures may not be preserved. Merging invalidates source digital signatures.</div><label className="file-picker">Choose PDF files<input type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={(event) => { if (event.currentTarget.files) void addFiles(event.currentTarget.files); event.currentTarget.value = ""; }}/></label><div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(event.dataTransfer.files); }}>Or drop PDF files here</div>{entries.length > 0 && <ol className="merge-list" aria-label="PDF merge order">{entries.map((entry, index) => <li key={entry.id} draggable={!busy} onDragStart={() => { dragIndex.current = index; }} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragIndex.current !== null) move(dragIndex.current, index); dragIndex.current = null; }}><span className="merge-order">{index + 1}</span><span className="merge-filename">{entry.file.name}</span><span>{(entry.file.size / 1024 / 1024).toFixed(2)} MB</span><button type="button" aria-label={`Move ${entry.file.name} up`} disabled={busy || index === 0} onClick={() => move(index, index - 1)}>↑</button><button type="button" aria-label={`Move ${entry.file.name} down`} disabled={busy || index === entries.length - 1} onClick={() => move(index, index + 1)}>↓</button><button type="button" aria-label={`Remove ${entry.file.name}`} disabled={busy} onClick={() => remove(entry.id)}>Remove</button></li>)}</ol>}<div className="merge-actions"><button type="button" className="hero-cta" disabled={busy || entries.length < 2} onClick={() => void merge()}>{busy ? "Merging…" : "Merge PDFs"}</button>{busy && <button type="button" onClick={cancel}>Cancel</button>}<span>{entries.length} file(s) · {(total / 1024 / 1024).toFixed(2)} MB</span></div>{busy && <p role="status" aria-live="polite">Processing in a dedicated browser worker. This may take a while; progress is indeterminate.</p>}{error && <p role="alert" className="merge-error">{error}</p>}{result && <div role="status" className="merge-success"><p>Validated PDF ready · {result.pages} pages</p><a className="hero-cta" href={result.url} download={result.name}>Download merged PDF</a></div>}</section>;
}
