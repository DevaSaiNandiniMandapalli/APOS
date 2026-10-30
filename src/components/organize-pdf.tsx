"use client";

import { useEffect, useRef, useState } from "react";
import { PDF_LIMITS } from "@/lib/pdf-limits";
import type { PageOperation } from "@/lib/organize-pdf";

type Reply = { action: string; ok: boolean; pageCount?: number; bytes?: ArrayBuffer; error?: string };
const operationDetails: Record<PageOperation, { title: string; verb: string; field: string; help: (count: number) => string }> = {
  delete: { title: "Delete PDF pages", verb: "Delete pages", field: "Pages to delete", help: (count) => `Enter pages or ranges from 1 to ${count}. At least one page must remain.` },
  reorder: { title: "Reorder PDF pages", verb: "Reorder pages", field: "New page order", help: (count) => `List all ${count} pages exactly once in the order you want, for example 3, 1-2.` },
  extract: { title: "Extract PDF pages", verb: "Extract pages", field: "Pages to extract", help: (count) => `Enter pages or ranges from 1 to ${count}. They are kept in the order listed.` },
  duplicate: { title: "Duplicate PDF pages", verb: "Duplicate pages", field: "Pages to duplicate", help: (count) => `Enter pages or ranges from 1 to ${count}. Copies are appended to the document.` },
  "add-blank": { title: "Add blank PDF pages", verb: "Add blank pages", field: "Number of blank pages", help: (count) => `Choose 1 to 20 pages and a position from 0 (before page 1) to ${count}.` },
};

export default function OrganizePdf({ operation }: { operation: PageOperation }) {
  const detail = operationDetails[operation];
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pages, setPages] = useState("");
  const [blankCount, setBlankCount] = useState(1);
  const [afterPage, setAfterPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ url: string; name: string; count: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const urlRef = useRef<string | null>(null);
  const taskRef = useRef(0);
  const mountedRef = useRef(false);

  const clearResult = () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; setResult(null); };

  const inspect = async (selected: File | undefined) => {
    if (!selected || busy) return;
    clearResult(); setError(""); setFile(null); setPageCount(0); setBusy(true);
    const task = ++taskRef.current;
    try {
      const buffer = await selected.arrayBuffer();
      if (task !== taskRef.current) { new Uint8Array(buffer).fill(0); return; }
      const worker = new Worker(new URL("@/workers/organize-pdf.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<Reply>) => {
        worker.terminate(); workerRef.current = null;
        if (!mountedRef.current || task !== taskRef.current) return;
        setBusy(false);
        if (!event.data.ok || !event.data.pageCount) { setError(event.data.error ?? "The PDF could not be opened."); return; }
        setFile(selected); setPageCount(event.data.pageCount);
        setPages(operation === "reorder" ? Array.from({ length: event.data.pageCount }, (_, index) => index + 1).join(",") : operation === "delete" ? "" : "1");
      };
      worker.onerror = () => { worker.terminate(); workerRef.current = null; if (mountedRef.current && task === taskRef.current) { setBusy(false); setError("PDF validation stopped unexpectedly."); } };
      worker.postMessage({ action: "inspect", file: buffer }, [buffer]);
    } catch { if (mountedRef.current && task === taskRef.current) { setBusy(false); setError("Unable to read the selected file."); } }
  };

  const process = async () => {
    if (!file) { setError("Choose a PDF first."); return; }
    if (operation === "add-blank" && (!Number.isInteger(blankCount) || blankCount < 1 || blankCount > 20)) { setError("Add between 1 and 20 blank pages."); return; }
    if (operation === "add-blank" && (!Number.isInteger(afterPage) || afterPage < 0 || afterPage > pageCount)) { setError(`Choose an insertion position from 0 to ${pageCount}.`); return; }
    clearResult(); setError(""); setBusy(true);
    const task = ++taskRef.current;
    try {
      const buffer = await file.arrayBuffer();
      if (task !== taskRef.current) { new Uint8Array(buffer).fill(0); return; }
      const worker = new Worker(new URL("@/workers/organize-pdf.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<Reply>) => {
        worker.terminate(); workerRef.current = null;
        if (!mountedRef.current || task !== taskRef.current) { if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0); return; }
        setBusy(false);
        if (!event.data.ok || !event.data.bytes || !event.data.pageCount) { setError(event.data.error ?? "The operation failed."); return; }
        const blob = new Blob([event.data.bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob); urlRef.current = url;
        new Uint8Array(event.data.bytes).fill(0);
        const stem = file.name.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 100) || "document";
        setResult({ url, name: `${stem}-${operation}.pdf`, count: event.data.pageCount });
      };
      worker.onerror = () => { worker.terminate(); workerRef.current = null; if (mountedRef.current && task === taskRef.current) { setBusy(false); setError("PDF processing stopped unexpectedly."); } };
      worker.postMessage({ action: "organize", file: buffer, options: { operation, pages, blankCount, afterPage } }, [buffer]);
    } catch { if (mountedRef.current && task === taskRef.current) { setBusy(false); setError("Unable to read the selected file."); } }
  };

  const cancel = () => { taskRef.current += 1; workerRef.current?.terminate(); workerRef.current = null; setBusy(false); setError("Operation cancelled. Temporary in-memory data was released."); };
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; taskRef.current += 1; workerRef.current?.terminate(); workerRef.current = null; if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; };
  }, []);

  return <section className="merge-panel" aria-labelledby="organize-heading">
    <h2 id="organize-heading">{detail.title} on this device</h2>
    <p>Make page changes in your browser. The source file is not uploaded to APOS.</p>
    <div className="privacy-note">Limit: one PDF up to {PDF_LIMITS.perFileBytes / 1024 / 1024} MB and {PDF_LIMITS.pages} pages. Current document: {pageCount || "not selected"} page(s).</div>
    <label className="file-picker">Choose a PDF<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => { void inspect(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label>
    {file && (operation === "add-blank" ? <div className="split-settings"><label htmlFor="blank-count">{detail.field}</label><input id="blank-count" className="split-range-input" type="number" min="1" max="20" value={blankCount} disabled={busy} onChange={(event) => setBlankCount(Number(event.target.value))}/><label htmlFor="blank-after">Insert after page (0 inserts before page 1)</label><input id="blank-after" className="split-range-input" type="number" min="0" max={pageCount} value={afterPage} disabled={busy} onChange={(event) => setAfterPage(Number(event.target.value))}/><p className="route-note">{detail.help(pageCount)} Blank pages match the adjacent page size.</p></div> : <div className="split-settings"><label htmlFor="organize-pages">{detail.field}</label><input id="organize-pages" className="split-range-input" value={pages} disabled={busy} onChange={(event) => setPages(event.target.value)} aria-describedby="organize-help"/><p id="organize-help" className="route-note">{detail.help(pageCount)}</p></div>)}
    <div className="merge-actions"><button type="button" className="hero-cta" disabled={busy || !file} onClick={() => void process()}>{busy ? "Processing…" : detail.verb}</button>{busy && <button type="button" onClick={cancel}>Cancel</button>}</div>
    {busy && <p role="status" aria-live="polite">Processing in a dedicated browser worker. Progress is indeterminate.</p>}{error && <p role="alert" className="merge-error">{error}</p>}
    {result && <div role="status" className="merge-success"><p>Validated PDF ready · {result.count} pages</p><a href={result.url} download={result.name}>Download updated PDF</a></div>}
  </section>;
}
