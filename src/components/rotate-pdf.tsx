"use client";

import { useEffect, useRef, useState } from "react";
import { checkPdfHeader, PDF_LIMITS } from "@/lib/pdf-limits";
import { formatBytes, pageLabel } from "@/lib/format";
import { safeFileStem } from "@/lib/pdf-images";
import type { RotateProgress } from "@/lib/rotate-pdf";
import { PdfDropzone } from "./pdf-tools/pdf-dropzone";
import { PdfPageGrid } from "./pdf-tools/pdf-page-grid";
import { PdfProgress } from "./pdf-tools/pdf-progress";
import { PdfResult } from "./pdf-tools/pdf-result";
import { usePdfDocument } from "./pdf-tools/use-pdf-document";

type WorkerReply =
  | { type: "progress"; progress: RotateProgress }
  | { type: "result"; ok: boolean; bytes?: ArrayBuffer; pageCount?: number; error?: string };

type RotateResult = { url: string; name: string; pages: number };

export default function RotatePdf() {
  const [file, setFile] = useState<File | null>(null);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(() => new Set());
  const [pending, setPending] = useState<Record<number, number>>({});
  const [angle, setAngle] = useState<90 | 180 | 270>(90);
  const [result, setResult] = useState<RotateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RotateProgress | null>(null);
  const [error, setError] = useState("");
  const workerRef = useRef<Worker | null>(null);
  const urlRef = useRef<string | null>(null);
  const taskRef = useRef(0);
  const mountedRef = useRef(false);
  const { document, pageCount, loading: previewLoading, error: previewError } = usePdfDocument(file);

  const hasRotations = Object.values(pending).some((delta) => ((delta % 360) + 360) % 360 !== 0);
  const overPageLimit = pageCount > PDF_LIMITS.pages;
  const canProcess = Boolean(file && document && !previewLoading && !previewError && !overPageLimit && !busy && hasRotations);

  const clearResult = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setResult(null);
  };

  const selectFile = async (selected: File | undefined) => {
    if (busy) return;
    clearResult();
    setError("");
    setFile(null);
    setSelectedPages(new Set());
    setPending({});
    if (!selected) return;
    if (!selected.size) { setError("The selected file is empty."); return; }
    if (selected.size > PDF_LIMITS.perFileBytes) { setError(`The PDF exceeds the ${PDF_LIMITS.perFileBytes / 1024 / 1024} MB file limit.`); return; }
    try {
      const head = new Uint8Array(await selected.slice(0, 1024).arrayBuffer());
      if (!checkPdfHeader(head)) { setError("This file does not have a PDF signature."); return; }
    } catch {
      setError("Unable to read the selected file.");
      return;
    }
    setFile(selected);
  };

  const togglePage = (page: number) => {
    if (busy) return;
    clearResult();
    setError("");
    setSelectedPages((current) => {
      const next = new Set(current);
      if (next.has(page)) next.delete(page); else next.add(page);
      return next;
    });
  };

  const selectAll = () => {
    if (busy) return;
    clearResult();
    setSelectedPages(new Set(Array.from({ length: pageCount }, (_, index) => index + 1)));
  };

  const clearSelection = () => {
    if (busy) return;
    clearResult();
    setSelectedPages(new Set());
  };

  const applyRotation = (scope: "selected" | "all") => {
    if (busy || !pageCount) return;
    clearResult();
    setError("");
    const pages = scope === "all"
      ? Array.from({ length: pageCount }, (_, index) => index + 1)
      : [...selectedPages];
    if (!pages.length) {
      setError("Select at least one page, or use “Rotate all pages”.");
      return;
    }
    setPending((current) => {
      const next = { ...current };
      for (const page of pages) {
        const value = (((next[page] ?? 0) + angle) % 360 + 360) % 360;
        if (value) next[page] = value; else delete next[page];
      }
      return next;
    });
  };

  const resetRotations = () => {
    if (busy) return;
    clearResult();
    setPending({});
    setError("");
  };

  const rotate = async () => {
    if (!file || !canProcess) {
      if (!hasRotations) setError("Apply at least one rotation before creating the PDF.");
      return;
    }
    clearResult();
    setError("");
    setProgress(null);
    setBusy(true);
    const task = ++taskRef.current;
    let buffer: ArrayBuffer | null = null;
    try {
      buffer = await file.arrayBuffer();
      if (task !== taskRef.current) { new Uint8Array(buffer).fill(0); buffer = null; return; }
      const worker = new Worker(new URL("@/workers/rotate-pdf.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        if (event.data.type === "progress") {
          if (task === taskRef.current && mountedRef.current) setProgress(event.data.progress);
          return;
        }
        worker.terminate();
        workerRef.current = null;
        if (!mountedRef.current || task !== taskRef.current) {
          if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0);
          return;
        }
        setBusy(false);
        setProgress(null);
        if (!event.data.ok || !event.data.bytes || !event.data.pageCount) {
          setError(event.data.error ?? "The rotation failed.");
          return;
        }
        try {
          if (!checkPdfHeader(new Uint8Array(event.data.bytes)) || event.data.pageCount !== pageCount) {
            throw new Error("The generated PDF failed validation.");
          }
          const blob = new Blob([event.data.bytes], { type: "application/pdf" });
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          setResult({ url, name: `${safeFileStem(file.name)}-rotated.pdf`, pages: event.data.pageCount });
        } catch {
          setError("The generated PDF failed validation and was discarded.");
        } finally {
          new Uint8Array(event.data.bytes).fill(0);
        }
      };
      worker.onerror = () => {
        worker.terminate();
        workerRef.current = null;
        if (mountedRef.current && task === taskRef.current) {
          setBusy(false);
          setProgress(null);
          setError("PDF processing stopped unexpectedly. Try a different file.");
        }
      };
      worker.postMessage({ file: buffer, rotations: pending }, [buffer]);
      buffer = null;
    } catch {
      if (buffer) new Uint8Array(buffer).fill(0);
      if (mountedRef.current && task === taskRef.current) {
        setBusy(false);
        setProgress(null);
        setError("Unable to read the selected file.");
      }
    }
  };

  const cancel = () => {
    taskRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(false);
    setProgress(null);
    setError("Rotation cancelled. Temporary in-memory data was released.");
  };

  const clearAll = () => {
    if (busy) return;
    taskRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    clearResult();
    setFile(null);
    setSelectedPages(new Set());
    setPending({});
    setAngle(90);
    setError("");
    setProgress(null);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      taskRef.current += 1;
      workerRef.current?.terminate();
      workerRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, []);

  return (
    <section className="merge-panel pdf-tool" aria-labelledby="rotate-heading">
      <h2 id="rotate-heading">Rotate PDF on this device</h2>
      <p>Preview the pages, select individual pages, and apply real PDF page rotations. Content and page order are preserved.</p>
      <div className="privacy-note">
        Limit: one PDF up to {PDF_LIMITS.perFileBytes / 1024 / 1024} MB and {PDF_LIMITS.pages} pages. The thumbnails show the page’s existing rotation plus any pending rotation. Only the pending rotation is written to the downloaded PDF.
      </div>
      <PdfDropzone label="Choose a PDF" hint="PDF only · up to 50 MB" disabled={busy} onFiles={(files) => void selectFile(files[0])} />
      {file ? (
        <div className="pdf-file-summary">
          <strong>{file.name}</strong>
          <span>{formatBytes(file.size)} · {previewLoading ? "Reading pages…" : previewError ? "Page count unavailable" : pageLabel(pageCount)}</span>
        </div>
      ) : null}
      {previewError ? <p role="alert" className="merge-error">{previewError}</p> : null}
      {overPageLimit ? <p role="alert" className="merge-error">This PDF has {pageCount} pages; the limit is {PDF_LIMITS.pages}.</p> : null}
      {file && document ? (
        <>
          <div className="split-settings pdf-config">
            <label htmlFor="rotate-angle">Rotation</label>
            <select id="rotate-angle" className="split-range-input" value={angle} disabled={busy} onChange={(event) => { clearResult(); setAngle(Number(event.target.value) as 90 | 180 | 270); }}>
              <option value={90}>90° clockwise</option>
              <option value={180}>180°</option>
              <option value={270}>270° clockwise</option>
            </select>
            <p className="route-note">Apply the selected angle to the pages you choose. Repeated applications accumulate per page.</p>
          </div>
          <PdfPageGrid
            document={document}
            pageCount={pageCount}
            mode="toggle"
            selected={selectedPages}
            rotationByPage={pending}
            onToggle={togglePage}
            onSelectAll={selectAll}
            onClearSelection={clearSelection}
            label="PDF pages"
          />
          <div className="merge-actions pdf-rotate-actions">
            <button type="button" onClick={() => applyRotation("selected")} disabled={busy || !selectedPages.size}>Rotate selected pages</button>
            <button type="button" onClick={() => applyRotation("all")} disabled={busy || !pageCount}>Rotate all pages</button>
            <button type="button" onClick={resetRotations} disabled={busy || !hasRotations}>Reset rotations</button>
            <span>{selectedPages.size} selected · {Object.keys(pending).length} page(s) with pending rotation</span>
          </div>
        </>
      ) : null}
      <div className="merge-actions">
        <button type="button" className="hero-cta" disabled={!canProcess} onClick={() => void rotate()}>{busy ? "Rotating…" : "Create rotated PDF"}</button>
        {busy ? <button type="button" onClick={cancel}>Cancel</button> : null}
        {file && !busy ? <button type="button" onClick={clearAll}>Reset</button> : null}
      </div>
      {busy ? <PdfProgress label="Rotating PDF" value={progress?.completed} max={progress?.total} detail={progress?.label ?? "Preparing the browser worker…"} /> : null}
      {error ? <p role="alert" className="merge-error">{error}</p> : null}
      {result ? (
        <PdfResult
          summary={`Validated rotated PDF · ${result.pages} pages`}
          downloads={[{ url: result.url, name: result.name }]}
          onReset={clearAll}
        />
      ) : null}
    </section>
  );
}
