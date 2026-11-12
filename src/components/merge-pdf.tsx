"use client";

import { useEffect, useRef, useState } from "react";
import { checkPdfHeader, PDF_LIMITS } from "@/lib/pdf-limits";
import { inspectPdfFile } from "@/lib/pdf-preview";
import { formatBytes } from "@/lib/format";
import { PdfDropzone } from "./pdf-tools/pdf-dropzone";
import { MergeFileList, type MergeEntry } from "./pdf-tools/merge-file-list";
import { PdfProgress } from "./pdf-tools/pdf-progress";
import { PdfResult } from "./pdf-tools/pdf-result";
import type { MergeProgress } from "@/lib/merge-pdf";

type WorkerReply =
  | { type: "progress"; progress: MergeProgress }
  | { type: "result"; ok: boolean; bytes?: ArrayBuffer; pageCount?: number; error?: string };

type MergeResult = { url: string; name: string; pages: number };

function outputFileName(value: string) {
  const stem = value.trim().replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 100) || "merged";
  return `${stem}.pdf`;
}

export default function MergePdf() {
  const [entries, setEntries] = useState<MergeEntry[]>([]);
  const [outputName, setOutputName] = useState("merged.pdf");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<MergeProgress | null>(null);
  const [result, setResult] = useState<MergeResult | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const resultUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const taskIdRef = useRef(0);

  const totalBytes = entries.reduce((sum, entry) => sum + entry.file.size, 0);
  const totalPages = entries.reduce((sum, entry) => sum + (entry.pageCount ?? 0), 0);
  const checking = entries.some((entry) => entry.status === "checking");
  const invalid = entries.some((entry) => entry.status === "invalid");
  const overPageLimit = totalPages > PDF_LIMITS.pages;
  const canMerge = !busy && !checking && !invalid && !overPageLimit && entries.length >= 2 && entries.length <= PDF_LIMITS.fileCount && totalBytes <= PDF_LIMITS.totalBytes;

  const clearResult = () => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
    setResult(null);
  };

  const addFiles = async (files: File[]) => {
    if (busy) return;
    setError("");
    clearResult();
    if (!files.length) return;
    if (entries.length + files.length > PDF_LIMITS.fileCount) {
      setError(`Choose no more than ${PDF_LIMITS.fileCount} PDF files.`);
      return;
    }
    if (files.some((file) => file.size === 0)) {
      setError("Empty files cannot be merged.");
      return;
    }
    if (files.some((file) => file.size > PDF_LIMITS.perFileBytes)) {
      setError(`Each PDF must be ${PDF_LIMITS.perFileBytes / 1024 / 1024} MB or smaller.`);
      return;
    }
    if (totalBytes + files.reduce((sum, file) => sum + file.size, 0) > PDF_LIMITS.totalBytes) {
      setError(`The selected PDFs exceed the ${PDF_LIMITS.totalBytes / 1024 / 1024} MB combined limit.`);
      return;
    }

    for (const file of files) {
      try {
        const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
        if (!checkPdfHeader(head)) {
          setError(`${file.name}: this file does not have a PDF signature.`);
          return;
        }
      } catch {
        setError(`Unable to read ${file.name}.`);
        return;
      }
    }

    const added: MergeEntry[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      pageCount: null,
      thumbnail: null,
      status: "checking",
    }));
    setEntries((current) => [...current, ...added]);

    for (const entry of added) {
      try {
        const info = await inspectPdfFile(entry.file);
        if (!mountedRef.current) return;
        setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, ...info, status: "ready" } : item));
      } catch {
        if (!mountedRef.current) return;
        setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, status: "invalid", error: "This PDF could not be opened. It may be corrupt, encrypted, or unsupported." } : item));
        setError(`${entry.file.name}: this PDF could not be opened. Remove it to continue.`);
      }
    }
  };

  const remove = (id: string) => {
    clearResult();
    setError("");
    setEntries((current) => current.filter((entry) => entry.id !== id));
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= entries.length || to === from) return;
    clearResult();
    setEntries((current) => {
      const copy = [...current];
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });
  };

  const clearAll = () => {
    if (busy) return;
    taskIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    clearResult();
    setEntries([]);
    setOutputName("merged.pdf");
    setError("");
    setProgress(null);
  };

  const cancel = () => {
    taskIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(false);
    setProgress(null);
    setError("Merge cancelled. Temporary in-memory data was released.");
  };

  const merge = async () => {
    setError("");
    clearResult();
    if (entries.length < 2) { setError("Select at least two PDF files."); return; }
    if (checking) { setError("Wait for the PDF page counts to finish checking."); return; }
    if (invalid) { setError("Remove the invalid PDF before merging."); return; }
    if (overPageLimit) { setError(`The selected PDFs total ${totalPages} pages; the limit is ${PDF_LIMITS.pages}.`); return; }
    if (totalBytes > PDF_LIMITS.totalBytes) { setError(`The selected PDFs exceed the ${PDF_LIMITS.totalBytes / 1024 / 1024} MB combined limit.`); return; }

    const expectedPages = totalPages;
    setBusy(true);
    setProgress(null);
    const taskId = ++taskIdRef.current;
    let buffers: ArrayBuffer[] | null = null;

    try {
      buffers = await Promise.all(entries.map(({ file }) => file.arrayBuffer()));
      if (taskId !== taskIdRef.current) {
        buffers.forEach((buffer) => new Uint8Array(buffer).fill(0));
        buffers = null;
        return;
      }
      const worker = new Worker(new URL("@/workers/merge-pdf.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        if (event.data.type === "progress") {
          if (taskId === taskIdRef.current && mountedRef.current) setProgress(event.data.progress);
          return;
        }
        worker.terminate();
        workerRef.current = null;
        if (!mountedRef.current || taskId !== taskIdRef.current) {
          if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0);
          return;
        }
        setBusy(false);
        setProgress(null);
        if (!event.data.ok || !event.data.bytes) {
          setError(event.data.error ?? "The merge failed.");
          return;
        }
        try {
          if (!checkPdfHeader(new Uint8Array(event.data.bytes)) || event.data.pageCount !== expectedPages) {
            throw new Error("The generated PDF failed validation.");
          }
          const blob = new Blob([event.data.bytes], { type: "application/pdf" });
          const url = URL.createObjectURL(blob);
          resultUrlRef.current = url;
          setResult({ url, name: outputFileName(outputName), pages: expectedPages });
        } catch {
          setError("The generated PDF failed validation and was discarded.");
        } finally {
          new Uint8Array(event.data.bytes).fill(0);
        }
      };
      worker.onerror = () => {
        worker.terminate();
        workerRef.current = null;
        if (mountedRef.current && taskId === taskIdRef.current) {
          setBusy(false);
          setProgress(null);
          setError("PDF processing stopped unexpectedly. Try different files.");
        }
      };
      worker.postMessage({ files: buffers }, buffers);
      buffers = null;
    } catch {
      if (buffers) buffers.forEach((buffer) => new Uint8Array(buffer).fill(0));
      if (mountedRef.current && taskId === taskIdRef.current) {
        setBusy(false);
        setProgress(null);
        setError("Unable to read the selected files.");
      }
    }
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

  return (
    <section className="merge-panel pdf-tool" aria-labelledby="merge-heading">
      <h2 id="merge-heading">Merge PDFs on this device</h2>
      <p>Your files are read and processed in this browser. They are not sent to APOS servers.</p>
      <div className="privacy-note">
        Limit: 2–{PDF_LIMITS.fileCount} PDFs, {PDF_LIMITS.perFileBytes / 1024 / 1024} MB per file, {PDF_LIMITS.totalBytes / 1024 / 1024} MB total, and {PDF_LIMITS.pages} pages. Page counts and first-page previews are checked before merging. Interactive forms, bookmarks, attachments, and source digital signatures may not be preserved.
      </div>
      <PdfDropzone
        label="Choose PDF files"
        hint={`PDF only · up to ${PDF_LIMITS.fileCount} files`}
        multiple
        disabled={busy}
        onFiles={(files) => void addFiles(files)}
      />
      <MergeFileList entries={entries} busy={busy} onMove={move} onRemove={remove} />
      <div className="pdf-summary-row">
        <span>{entries.length} file(s) · {formatBytes(totalBytes)} · {totalPages} pages</span>
        {entries.length > 0 ? <button type="button" onClick={clearAll} disabled={busy}>Clear all</button> : null}
      </div>
      {overPageLimit ? <p role="alert" className="merge-error">The selected PDFs total {totalPages} pages; the limit is {PDF_LIMITS.pages}.</p> : null}
      <div className="split-settings pdf-config">
        <label htmlFor="merge-output-name">Output filename</label>
        <input id="merge-output-name" className="split-range-input" value={outputName} maxLength={120} disabled={busy} onChange={(event) => { setOutputName(event.target.value); clearResult(); }} />
        <p className="route-note">The download name is sanitised and always ends in .pdf.</p>
      </div>
      <div className="merge-actions">
        <button type="button" className="hero-cta" disabled={!canMerge} onClick={() => void merge()}>{busy ? "Merging…" : "Merge PDFs"}</button>
        {busy ? <button type="button" onClick={cancel}>Cancel</button> : null}
      </div>
      {busy ? <PdfProgress label="Merging PDFs" value={progress?.completed} max={progress?.total} detail={progress?.label ?? "Preparing the browser worker…"} /> : null}
      {error ? <p role="alert" className="merge-error">{error}</p> : null}
      {result ? (
        <PdfResult
          summary={`Validated merged PDF · ${result.pages} pages`}
          downloads={[{ url: result.url, name: result.name }]}
          onReset={clearAll}
        />
      ) : null}
    </section>
  );
}
