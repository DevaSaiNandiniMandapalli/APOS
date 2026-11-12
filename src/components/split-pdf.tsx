"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { checkPdfHeader, PDF_LIMITS } from "@/lib/pdf-limits";
import { formatBytes, pageLabel } from "@/lib/format";
import { safeFileStem } from "@/lib/pdf-images";
import {
  buildEqualRanges,
  buildEveryPageRanges,
  formatPageRanges,
  pagesToRanges,
  parsePageRanges,
  type PageRange,
} from "@/lib/split-pdf";
import type { SplitProgress } from "@/lib/split-pdf";
import { PdfDropzone } from "./pdf-tools/pdf-dropzone";
import { PdfPageGrid } from "./pdf-tools/pdf-page-grid";
import { PdfProgress } from "./pdf-tools/pdf-progress";
import { PdfResult } from "./pdf-tools/pdf-result";
import { usePdfDocument } from "./pdf-tools/use-pdf-document";

type SplitMode = "extract" | "individual" | "ranges" | "groups";
type SplitOutput = { url: string; name: string; pages: number; blob: Blob };
type WorkerReply =
  | { type: "progress"; progress: SplitProgress }
  | { type: "result"; ok: boolean; files?: ArrayBuffer[]; pageCount?: number; error?: string };
type ZipReply = { ok: boolean; bytes?: ArrayBuffer; error?: string };

const MODES: { value: SplitMode; label: string; help: string }[] = [
  { value: "extract", label: "Extract selected pages", help: "Combine the pages you select into one PDF." },
  { value: "individual", label: "Split into individual pages", help: "Create one PDF for every page." },
  { value: "ranges", label: "Split by custom page ranges", help: "Each comma-separated range becomes its own PDF." },
  { value: "groups", label: "Split into equal page groups", help: "Create sequential PDFs with the same number of pages." },
];

export default function SplitPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<SplitMode>("ranges");
  const [rangeText, setRangeText] = useState("1");
  const [selectedPages, setSelectedPages] = useState<Set<number>>(() => new Set([1]));
  const [extractRangeError, setExtractRangeError] = useState("");
  const [pagesPerFile, setPagesPerFile] = useState(1);
  const [outputs, setOutputs] = useState<SplitOutput[]>([]);
  const [zipUrl, setZipUrl] = useState("");
  const [zipName, setZipName] = useState("");
  const [zipBusy, setZipBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SplitProgress | null>(null);
  const [error, setError] = useState("");
  const workerRef = useRef<Worker | null>(null);
  const zipWorkerRef = useRef<Worker | null>(null);
  const taskRef = useRef(0);
  const zipTaskRef = useRef(0);
  const mountedRef = useRef(false);
  const urlsRef = useRef<string[]>([]);
  const zipUrlRef = useRef<string | null>(null);
  const { document, pageCount, loading: previewLoading, error: previewError } = usePdfDocument(file);

  const stem = file ? safeFileStem(file.name) : "document";
  const rangeParse = useMemo(() => {
    if (!pageCount) return { ranges: [] as PageRange[], error: "" };
    try {
      return { ranges: parsePageRanges(rangeText, pageCount), error: "" };
    } catch (reason) {
      return { ranges: [] as PageRange[], error: reason instanceof Error ? reason.message : "Enter valid page ranges." };
    }
  }, [pageCount, rangeText]);
  const highlightedPages = useMemo(() => {
    if (mode !== "ranges") return undefined;
    return new Set(rangeParse.ranges.flatMap((range) => Array.from({ length: range.last - range.first + 1 }, (_, index) => range.first + index)));
  }, [mode, rangeParse.ranges]);
  const rangeError = mode === "ranges" ? rangeParse.error : mode === "extract" ? extractRangeError || (selectedPages.size ? "" : "Select at least one page.") : "";
  const overPageLimit = pageCount > PDF_LIMITS.pages;
  const canProcess = Boolean(file && document && !previewLoading && !previewError && !overPageLimit && !busy && !zipBusy && !rangeError && (
    mode === "extract" ? selectedPages.size > 0
      : mode === "ranges" ? rangeParse.ranges.length > 0
        : mode === "individual" ? pageCount > 0
          : pageCount > 0 && pagesPerFile >= 1 && pagesPerFile <= pageCount
  ));

  const clearZip = () => {
    if (zipUrlRef.current) URL.revokeObjectURL(zipUrlRef.current);
    zipUrlRef.current = null;
    setZipUrl("");
    setZipName("");
  };

  const clearOutputs = () => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
    clearZip();
    setOutputs([]);
  };

  const selectFile = async (selected: File | undefined) => {
    if (busy || zipBusy) return;
    clearOutputs();
    setError("");
    setFile(null);
    setExtractRangeError("");
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
    setMode("ranges");
    setRangeText("1");
    setSelectedPages(new Set([1]));
    setPagesPerFile(1);
  };

  const applyExtractRange = (value: string) => {
    clearOutputs();
    setError("");
    setRangeText(value);
    if (!pageCount) return;
    try {
      const ranges = parsePageRanges(value, pageCount);
      const pages = ranges.flatMap((range) => Array.from({ length: range.last - range.first + 1 }, (_, index) => range.first + index));
      setSelectedPages(new Set(pages));
      setExtractRangeError("");
    } catch (reason) {
      setExtractRangeError(reason instanceof Error ? reason.message : "Enter valid page ranges.");
    }
  };

  const togglePage = (page: number) => {
    if (busy || zipBusy) return;
    clearOutputs();
    setError("");
    const next = new Set(selectedPages);
    if (next.has(page)) next.delete(page); else next.add(page);
    setSelectedPages(next);
    setRangeText(formatPageRanges(pagesToRanges(next)));
    setExtractRangeError(next.size ? "" : "Select at least one page.");
  };

  const selectAll = () => {
    clearOutputs();
    setSelectedPages(new Set(Array.from({ length: pageCount }, (_, index) => index + 1)));
    setRangeText(pageCount ? `1-${pageCount}` : "");
    setExtractRangeError("");
  };

  const clearSelection = () => {
    clearOutputs();
    setSelectedPages(new Set());
    setRangeText("");
    setExtractRangeError("Select at least one page.");
  };

  const changeMode = (next: SplitMode) => {
    if (busy || zipBusy) return;
    clearOutputs();
    setError("");
    setMode(next);
    if (next === "extract" && pageCount) {
      try {
        const ranges = parsePageRanges(rangeText, pageCount);
        const pages = ranges.flatMap((range) => Array.from({ length: range.last - range.first + 1 }, (_, index) => range.first + index));
        setSelectedPages(new Set(pages));
        setExtractRangeError(pages.length ? "" : "Select at least one page.");
      } catch (reason) {
        setExtractRangeError(reason instanceof Error ? reason.message : "Enter valid page ranges.");
      }
    } else if (next === "ranges" && selectedPages.size) {
      setRangeText(formatPageRanges(pagesToRanges(selectedPages)));
    }
  };

  const changePagesPerFile = (value: number) => {
    clearOutputs();
    setError("");
    setPagesPerFile(value);
  };

  const process = async () => {
    if (!file || !canProcess) {
      if (rangeError) setError(rangeError);
      return;
    }
    let ranges: PageRange[] | null = null;
    let pages: number[] | null = null;
    if (mode === "extract") pages = [...selectedPages].sort((left, right) => left - right);
    else if (mode === "ranges") ranges = parsePageRanges(rangeText, pageCount);
    else if (mode === "individual") ranges = buildEveryPageRanges(pageCount);
    else ranges = buildEqualRanges(pageCount, pagesPerFile);

    clearOutputs();
    setError("");
    setProgress(null);
    setBusy(true);
    const task = ++taskRef.current;
    let buffer: ArrayBuffer | null = null;

    try {
      buffer = await file.arrayBuffer();
      if (task !== taskRef.current) { new Uint8Array(buffer).fill(0); buffer = null; return; }
      const worker = new Worker(new URL("@/workers/split-pdf.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        if (event.data.type === "progress") {
          if (task === taskRef.current && mountedRef.current) setProgress(event.data.progress);
          return;
        }
        worker.terminate();
        workerRef.current = null;
        if (!mountedRef.current || task !== taskRef.current) {
          event.data.files?.forEach((bytes) => new Uint8Array(bytes).fill(0));
          return;
        }
        setBusy(false);
        setProgress(null);
        if (!event.data.ok || !event.data.files) {
          setError(event.data.error ?? "The split failed.");
          return;
        }
        try {
          const expected = mode === "extract" ? 1 : ranges?.length ?? 0;
          if (event.data.files.length !== expected) throw new Error("The split output count did not match the request.");
          const ready: SplitOutput[] = [];
          for (let index = 0; index < event.data.files.length; index += 1) {
            const bytes = event.data.files[index];
            const range = mode === "extract" ? { first: 1, last: pages?.length ?? 0 } : ranges![index];
            const expectedPages = mode === "extract" ? pages?.length ?? 0 : range.last - range.first + 1;
            const blob = new Blob([bytes], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);
            urlsRef.current.push(url);
            const name = mode === "individual"
              ? `${stem}-page-${String(range.first).padStart(4, "0")}.pdf`
              : mode === "extract"
                ? `${stem}-selected-pages.pdf`
                : `${stem}-pages-${range.first}-${range.last}.pdf`;
            ready.push({ url, name, pages: expectedPages, blob });
            new Uint8Array(bytes).fill(0);
          }
          if (!mountedRef.current || task !== taskRef.current) { clearOutputs(); return; }
          setOutputs(ready);
        } catch {
          clearOutputs();
          if (mountedRef.current && task === taskRef.current) setError("A generated PDF failed validation and was discarded.");
        } finally {
          event.data.files.forEach((bytes) => new Uint8Array(bytes).fill(0));
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
      if (mode === "extract") worker.postMessage({ mode: "extract", file: buffer, pages }, [buffer]);
      else worker.postMessage({ mode: "ranges", file: buffer, ranges }, [buffer]);
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
    setError("Split cancelled. Temporary in-memory data was released.");
  };

  const makeZip = async () => {
    if (outputs.length < 2 || busy || zipBusy) return;
    clearZip();
    setError("");
    setZipBusy(true);
    const task = ++zipTaskRef.current;
    try {
      const files = await Promise.all(outputs.map(async (output) => ({ name: output.name, bytes: await output.blob.arrayBuffer() })));
      if (task !== zipTaskRef.current) { files.forEach(({ bytes }) => new Uint8Array(bytes).fill(0)); return; }
      const worker = new Worker(new URL("@/workers/zip-files.worker.ts", import.meta.url), { type: "module" });
      zipWorkerRef.current = worker;
      worker.onmessage = (event: MessageEvent<ZipReply>) => {
        worker.terminate();
        zipWorkerRef.current = null;
        if (!mountedRef.current || task !== zipTaskRef.current) {
          if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0);
          return;
        }
        setZipBusy(false);
        if (!event.data.ok || !event.data.bytes || event.data.bytes.byteLength < 22) {
          if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0);
          setError(event.data.error ?? "The ZIP archive failed output validation.");
          return;
        }
        const signature = new Uint8Array(event.data.bytes, 0, 2);
        if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
          new Uint8Array(event.data.bytes).fill(0);
          setError("The generated ZIP did not have a valid archive signature.");
          return;
        }
        const url = URL.createObjectURL(new Blob([event.data.bytes], { type: "application/zip" }));
        zipUrlRef.current = url;
        setZipUrl(url);
        setZipName(`${stem}-split.zip`);
        new Uint8Array(event.data.bytes).fill(0);
      };
      worker.onerror = () => {
        worker.terminate();
        zipWorkerRef.current = null;
        if (mountedRef.current && task === zipTaskRef.current) {
          setZipBusy(false);
          setError("ZIP creation stopped unexpectedly.");
        }
      };
      worker.postMessage({ files }, files.map(({ bytes }) => bytes));
    } catch {
      if (mountedRef.current && task === zipTaskRef.current) {
        setZipBusy(false);
        setError("Unable to prepare the ZIP archive.");
      }
    }
  };

  const cancelZip = () => {
    zipTaskRef.current += 1;
    zipWorkerRef.current?.terminate();
    zipWorkerRef.current = null;
    setZipBusy(false);
    setError("ZIP creation cancelled. Individual downloads remain available.");
  };

  const clearAll = () => {
    if (busy || zipBusy) return;
    taskRef.current += 1;
    zipTaskRef.current += 1;
    workerRef.current?.terminate();
    zipWorkerRef.current?.terminate();
    workerRef.current = null;
    zipWorkerRef.current = null;
    clearOutputs();
    setFile(null);
    setMode("ranges");
    setRangeText("1");
    setSelectedPages(new Set());
    setPagesPerFile(1);
    setError("");
    setExtractRangeError("");
    setProgress(null);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      taskRef.current += 1;
      zipTaskRef.current += 1;
      workerRef.current?.terminate();
      zipWorkerRef.current?.terminate();
      workerRef.current = null;
      zipWorkerRef.current = null;
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = [];
      if (zipUrlRef.current) URL.revokeObjectURL(zipUrlRef.current);
      zipUrlRef.current = null;
    };
  }, []);

  const modeInfo = MODES.find((item) => item.value === mode) ?? MODES[2];
  const processLabel = mode === "extract" ? "Extract selected pages" : mode === "individual" ? "Split every page" : mode === "groups" ? "Split into groups" : "Split PDF";

  return (
    <section className="merge-panel pdf-tool" aria-labelledby="split-heading">
      <h2 id="split-heading">Split PDF on this device</h2>
      <p>Select pages or ranges and create separate, validated PDF files. Your document stays in this browser.</p>
      <div className="privacy-note">
        Limit: one PDF up to {PDF_LIMITS.perFileBytes / 1024 / 1024} MB and {PDF_LIMITS.pages} pages, up to {PDF_LIMITS.splitOutputs} outputs and {PDF_LIMITS.splitTotalBytes / 1024 / 1024} MB combined. Every output is reopened and checked before download.
      </div>
      <PdfDropzone label="Choose a PDF" hint="PDF only · up to 50 MB" disabled={busy || zipBusy} onFiles={(files) => void selectFile(files[0])} />
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
            <label htmlFor="split-mode">Split mode</label>
            <select id="split-mode" className="split-range-input" value={mode} disabled={busy || zipBusy} onChange={(event) => changeMode(event.target.value as SplitMode)}>
              {MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <p className="route-note">{modeInfo.help}</p>
            {mode === "extract" || mode === "ranges" ? (
              <>
                <label htmlFor="split-ranges">Page ranges</label>
                <input
                  id="split-ranges"
                  className="split-range-input"
                  value={rangeText}
                  disabled={busy || zipBusy}
                  onChange={(event) => mode === "extract" ? applyExtractRange(event.target.value) : (clearOutputs(), setRangeText(event.target.value))}
                  aria-describedby="split-range-help"
                />
                <p id="split-range-help" className="route-note">Use comma-separated pages or ranges, such as 1-3, 5. {mode === "extract" ? "You can also click page thumbnails." : "Each range becomes its own PDF."}</p>
              </>
            ) : null}
            {mode === "groups" ? (
              <>
                <label htmlFor="split-pages-per-file">Pages per file</label>
                <input id="split-pages-per-file" className="split-range-input" type="number" min={1} max={Math.max(1, pageCount)} value={pagesPerFile} disabled={busy || zipBusy} onChange={(event) => changePagesPerFile(Number(event.target.value))} />
                <p className="route-note">The last group may contain fewer pages.</p>
              </>
            ) : null}
          </div>
          <PdfPageGrid
            document={document}
            pageCount={pageCount}
            mode={mode === "extract" ? "toggle" : "none"}
            selected={mode === "extract" ? selectedPages : undefined}
            highlighted={highlightedPages}
            onToggle={mode === "extract" ? togglePage : undefined}
            onSelectAll={mode === "extract" ? selectAll : undefined}
            onClearSelection={mode === "extract" ? clearSelection : undefined}
            label="PDF pages"
          />
        </>
      ) : null}
      {rangeError && mode !== "ranges" ? <p role="alert" className="merge-error">{rangeError}</p> : null}
      {rangeError && mode === "ranges" ? <p role="alert" className="merge-error">{rangeError}</p> : null}
      <div className="merge-actions">
        <button type="button" className="hero-cta" disabled={!canProcess} onClick={() => void process()}>{busy ? "Splitting…" : processLabel}</button>
        {busy ? <button type="button" onClick={cancel}>Cancel</button> : null}
        {file && !busy && !zipBusy ? <button type="button" onClick={clearAll}>Reset</button> : null}
      </div>
      {busy ? <PdfProgress label="Splitting PDF" value={progress?.completed} max={progress?.total} detail={progress?.label ?? "Preparing the browser worker…"} /> : null}
      {zipBusy ? <PdfProgress label="Creating ZIP archive" detail="Packaging the validated PDFs…" /> : null}
      {error ? <p role="alert" className="merge-error">{error}</p> : null}
      {outputs.length > 0 ? (
        <PdfResult
          summary={`Validated ${outputs.length} PDF file${outputs.length === 1 ? "" : "s"} · ${outputs.reduce((sum, output) => sum + output.pages, 0)} pages`}
          downloads={outputs.map((output) => ({ url: output.url, name: output.name, meta: pageLabel(output.pages) }))}
          zip={zipUrl ? { url: zipUrl, name: zipName } : null}
          onReset={clearAll}
        >
          {outputs.length > 1 ? (
            <div className="pdf-result-actions">
              {zipUrl ? null : <button type="button" onClick={() => void makeZip()} disabled={zipBusy}>{zipBusy ? "Creating ZIP…" : "Create ZIP of all outputs"}</button>}
              {zipBusy ? <button type="button" onClick={cancelZip}>Cancel ZIP</button> : null}
            </div>
          ) : null}
        </PdfResult>
      ) : null}
    </section>
  );
}
