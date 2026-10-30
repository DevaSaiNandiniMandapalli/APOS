"use client";

import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS } from "@/lib/pdf-limits";
import { safeFileStem } from "@/lib/pdf-images";
import { METADATA_FIELDS, type PdfMetadata } from "@/lib/pdf-metadata";

type Reply = { ok: boolean; metadata?: PdfMetadata; pageCount?: number; output?: ArrayBuffer; error?: string };
const fieldNames: Record<keyof PdfMetadata, string> = { title: "Title", author: "Author", subject: "Subject", keywords: "Keywords", creator: "Creator", producer: "Producer" };
const emptyMetadata = (): PdfMetadata => ({ title: "", author: "", subject: "", keywords: "", creator: "", producer: "" });
export default function PdfMetadataTool() {
  const [file, setFile] = useState<File | null>(null); const [metadata, setMetadata] = useState<PdfMetadata>(emptyMetadata); const [pageCount, setPageCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [url, setUrl] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null); const urlRef = useRef<string | null>(null); const run = useRef(0); const mounted = useRef(false);
  const revoke = () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; setUrl(null); };
  const choose = async (selected?: File) => {
    if (busy) return; revoke(); setFile(null); setPageCount(null); setMetadata(emptyMetadata()); setError(""); if (!selected) return;
    if (!selected.size || selected.size > PDF_LIMITS.perFileBytes) { setError("Choose a non-empty PDF under 50 MB."); return; }
    try { if (!checkPdfHeader(new Uint8Array(await selected.slice(0, 1024).arrayBuffer()))) { setError("This file does not have a PDF signature."); return; } setFile(selected); }
    catch { setError("Unable to read the selected PDF."); }
  };
  const cancel = () => { run.current += 1; worker.current?.terminate(); worker.current = null; setBusy(false); setError("Processing cancelled. Temporary browser data was released."); };
  const runWorker = async (action: "inspect" | "update") => {
    if (!file || busy || (action === "update" && pageCount === null)) return;
    revoke(); setError(""); setBusy(true); const current = ++run.current;
    let bytes: ArrayBuffer | null = null;
    try {
      bytes = await file.arrayBuffer();
      if (current !== run.current) { if (bytes.byteLength) new Uint8Array(bytes).fill(0); return; }
      const active = new Worker(new URL("@/workers/pdf-metadata.worker.ts", import.meta.url), { type: "module" }); worker.current = active;
      active.onmessage = async (event: MessageEvent<Reply>) => {
        active.terminate(); worker.current = null;
        if (current !== run.current || !mounted.current) { if (event.data.output?.byteLength) new Uint8Array(event.data.output).fill(0); return; }
        try {
          if (!event.data.ok) throw new Error(event.data.error ?? "PDF metadata could not be processed.");
          if (action === "inspect") { if (!event.data.metadata || !event.data.pageCount) throw new Error("The PDF metadata response was incomplete."); setMetadata(event.data.metadata); setPageCount(event.data.pageCount); }
          else {
            if (!event.data.output || !checkPdfHeader(new Uint8Array(event.data.output))) throw new Error("The updated PDF failed its signature check.");
            const checked = await PDFDocument.load(event.data.output, { updateMetadata: false });
            if (checked.getPageCount() !== pageCount) throw new Error("The updated PDF failed its page-count check.");
            if (current !== run.current || !mounted.current) return;
            const objectUrl = URL.createObjectURL(new Blob([event.data.output], { type: "application/pdf" })); urlRef.current = objectUrl; setUrl(objectUrl);
          }
        } catch (reason) { if (current === run.current && mounted.current) setError(reason instanceof Error ? reason.message : "The PDF metadata operation failed."); }
        finally { if (event.data.output?.byteLength) new Uint8Array(event.data.output).fill(0); if (current === run.current && mounted.current) setBusy(false); }
      };
      active.onerror = () => { active.terminate(); worker.current = null; if (current === run.current && mounted.current) { setBusy(false); setError("PDF metadata processing stopped unexpectedly."); } };
      active.postMessage({ action, bytes, ...(action === "update" ? { metadata } : {}) }, [bytes]); bytes = null;
    } catch { if (current === run.current && mounted.current) { setBusy(false); setError("Unable to read the selected PDF."); } }
    finally { if (bytes?.byteLength) new Uint8Array(bytes).fill(0); }
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; run.current += 1; worker.current?.terminate(); if (urlRef.current) URL.revokeObjectURL(urlRef.current); }; }, []);
  return <section className="merge-panel" aria-labelledby="pdf-metadata-heading"><h2 id="pdf-metadata-heading">Inspect and edit supported PDF metadata</h2><p>Read or update the standard title, author, subject, keywords, creator, and producer document-information fields.</p><div className="privacy-note">Metadata and document contents remain in browser memory. The PDF is reopened and validated before a changed file is offered.</div><label className="file-picker">Choose a PDF<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => { void choose(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label>{file && <p><strong>{file.name}</strong> · {(file.size / 1024).toFixed(1)} KB</p>}<div className="merge-actions"><button type="button" className="hero-cta" disabled={!file || busy} onClick={() => void runWorker("inspect")}>{busy ? "Processing…" : pageCount === null ? "Inspect metadata" : "Re-read metadata"}</button>{busy && <button type="button" onClick={cancel}>Cancel</button>}</div>{pageCount !== null && <><p role="status">Read metadata from a {pageCount}-page PDF. Blank values clear those supported fields when saved.</p><div className="split-settings">{METADATA_FIELDS.map((field) => <div key={field}><label htmlFor={`metadata-${field}`}>{fieldNames[field]}</label><input id={`metadata-${field}`} className="split-range-input" maxLength={1000} value={metadata[field]} disabled={busy} onChange={(event) => setMetadata((current) => ({ ...current, [field]: event.target.value }))}/></div>)}</div><div className="merge-actions"><button type="button" className="hero-cta" disabled={busy} onClick={() => void runWorker("update")}>{busy ? "Saving metadata…" : "Save metadata changes"}</button></div></>}{error && <p role="alert" className="merge-error">{error}</p>}{url && <p role="status" className="merge-success"><a href={url} download={`${safeFileStem(file?.name ?? "document")}-metadata.pdf`}>Download validated PDF</a></p>}</section>;
}
