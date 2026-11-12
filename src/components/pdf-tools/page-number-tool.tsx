"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { checkPdfHeader, PDF_LIMITS } from "@/lib/pdf-limits";
import { formatBytes, pageLabel } from "@/lib/format";
import { safeFileStem } from "@/lib/pdf-images";
import {
  computeMarkLayout,
  FONT_FAMILIES,
  formatPageNumber,
  NUMBER_FORMATS,
  rotatedMarkBounds,
  type FontFamily,
  type MarkOptions,
  type MarkPosition,
  type MarkProgress,
  type PageNumberFormat,
  type TextAlign,
} from "@/lib/pdf-marking";
import { parsePageRanges } from "@/lib/split-pdf";
import { PdfDropzone } from "./pdf-dropzone";
import { PdfPageGrid } from "./pdf-page-grid";
import { PdfPagePreview } from "./pdf-page-preview";
import { PdfProgress } from "./pdf-progress";
import { PdfResult } from "./pdf-result";
import { usePdfDocument } from "./use-pdf-document";

type WorkerReply =
  | { type: "progress"; progress: MarkProgress }
  | { type: "result"; ok: boolean; output?: ArrayBuffer; error?: string };

const FONT_STACK: Record<FontFamily, { family: string; weight: string }> = {
  helvetica: { family: "Helvetica, Arial, sans-serif", weight: "400" },
  "helvetica-bold": { family: "Helvetica, Arial, sans-serif", weight: "700" },
  times: { family: "'Times New Roman', Times, serif", weight: "400" },
  "times-bold": { family: "'Times New Roman', Times, serif", weight: "700" },
  courier: { family: "'Courier New', Courier, monospace", weight: "400" },
  "courier-bold": { family: "'Courier New', Courier, monospace", weight: "700" },
};

const PAGE_POSITIONS: { value: MarkPosition; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top center" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" },
];

let measureCanvas: HTMLCanvasElement | null = null;

function measureText(text: string, size: number, family: FontFamily) {
  if (typeof document === "undefined") return text.length * size * 0.55;
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  const context = measureCanvas.getContext("2d");
  if (!context) return text.length * size * 0.55;
  const font = FONT_STACK[family];
  context.font = `${font.weight} ${size}px ${font.family}`;
  return context.measureText(text).width;
}

export default function PageNumberTool() {
  const [file, setFile] = useState<File | null>(null);
  const [vertical, setVertical] = useState<"top" | "bottom">("bottom");
  const [align, setAlign] = useState<TextAlign>("center");
  const [fontFamily, setFontFamily] = useState<FontFamily>("helvetica");
  const [fontSize, setFontSize] = useState(12);
  const [color, setColor] = useState("#40404d");
  const [startNumber, setStartNumber] = useState(1);
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [numberFormat, setNumberFormat] = useState<PageNumberFormat>("decimal");
  const [pagesText, setPagesText] = useState("");
  const [skipCover, setSkipCover] = useState(false);
  const [margin, setMargin] = useState(24);
  const [previewPage, setPreviewPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<MarkProgress | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ url: string; name: string; pages: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const urlRef = useRef<string | null>(null);
  const taskRef = useRef(0);
  const mountedRef = useRef(false);
  const { document, pageCount, loading: previewLoading, error: previewError } = usePdfDocument(file);

  const position = `${vertical}-${align}` as MarkPosition;
  const rangeParse = useMemo(() => {
    if (!pageCount) return { pages: [] as number[], error: "" };
    try {
      const ranges = pagesText.trim() ? parsePageRanges(pagesText, pageCount) : [{ first: 1, last: pageCount }];
      const pages = ranges.flatMap((range) => Array.from({ length: range.last - range.first + 1 }, (_, index) => range.first + index));
      return { pages: skipCover ? pages.filter((page) => page !== 1) : pages, error: "" };
    } catch (reason) {
      return { pages: [] as number[], error: reason instanceof Error ? reason.message : "Enter valid page ranges." };
    }
  }, [pageCount, pagesText, skipCover]);
  const highlightedPages = useMemo(() => new Set(rangeParse.pages), [rangeParse.pages]);
  const overPageLimit = pageCount > PDF_LIMITS.pages;
  const safePreviewPage = pageCount ? Math.min(previewPage, pageCount) : previewPage;
  const rangeError = rangeParse.error || (rangeParse.pages.length ? "" : "Select at least one page.");
  const canProcess = Boolean(file && document && !previewLoading && !previewError && !overPageLimit && !busy && !rangeError);

  const clearResult = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setResult(null);
  };

  const change = (fn: () => void) => {
    clearResult();
    setError("");
    fn();
  };

  const selectPdf = async (selected: File | undefined) => {
    if (busy) return;
    clearResult();
    setError("");
    setFile(null);
    if (!selected) return;
    if (!selected.size) { setError("The selected file is empty."); return; }
    if (selected.size > PDF_LIMITS.perFileBytes) { setError(`The PDF exceeds the ${PDF_LIMITS.perFileBytes / 1024 / 1024} MB file limit.`); return; }
    try {
      const head = new Uint8Array(await selected.slice(0, 1024).arrayBuffer());
      if (!checkPdfHeader(head)) { setError("This file does not have a PDF signature."); return; }
    } catch {
      setError("Unable to read the selected PDF.");
      return;
    }
    setFile(selected);
    setPagesText("");
    setPreviewPage(1);
  };

  const process = async () => {
    if (!file || !canProcess) {
      if (rangeError) setError(rangeError);
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
      const options: MarkOptions = {
        operation: "page-number",
        mode: "text",
        text: "",
        pages: pagesText.trim() || "all",
        position,
        rotation: 0,
        opacity: 1,
        fontSize,
        fontFamily,
        color,
        startNumber,
        prefix,
        suffix,
        numberFormat,
        skipCover,
        margin,
        align,
        valign: vertical,
      };
      const worker = new Worker(new URL("@/workers/pdf-marking.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        if (event.data.type === "progress") {
          if (task === taskRef.current && mountedRef.current) setProgress(event.data.progress);
          return;
        }
        worker.terminate();
        workerRef.current = null;
        if (!mountedRef.current || task !== taskRef.current) {
          if (event.data.output) new Uint8Array(event.data.output).fill(0);
          return;
        }
        setBusy(false);
        setProgress(null);
        if (!event.data.ok || !event.data.output) {
          setError(event.data.error ?? "The page numbers could not be added.");
          return;
        }
        try {
          if (!checkPdfHeader(new Uint8Array(event.data.output))) throw new Error("The generated PDF failed signature validation.");
          const blob = new Blob([event.data.output], { type: "application/pdf" });
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          setResult({ url, name: `${safeFileStem(file.name)}-numbered.pdf`, pages: rangeParse.pages.length });
        } catch {
          setError("The generated PDF failed validation and was discarded.");
        } finally {
          new Uint8Array(event.data.output).fill(0);
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
      worker.postMessage({ bytes: buffer, options }, [buffer]);
      buffer = null;
    } catch {
      if (buffer) new Uint8Array(buffer).fill(0);
      if (mountedRef.current && task === taskRef.current) {
        setBusy(false);
        setProgress(null);
        setError("Unable to process the PDF.");
      }
    }
  };

  const cancel = () => {
    taskRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(false);
    setProgress(null);
    setError("Processing cancelled. Temporary browser data was released.");
  };

  const clearAll = () => {
    if (busy) return;
    taskRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    clearResult();
    setFile(null);
    setVertical("bottom");
    setAlign("center");
    setFontFamily("helvetica");
    setFontSize(12);
    setColor("#40404d");
    setStartNumber(1);
    setPrefix("");
    setSuffix("");
    setNumberFormat("decimal");
    setPagesText("");
    setSkipCover(false);
    setMargin(24);
    setPreviewPage(1);
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

  const previewOverlay = (size: { displayWidth: number; displayHeight: number; pageWidth: number; pageHeight: number; rotation: number }) => {
    const selectedIndex = rangeParse.pages.indexOf(safePreviewPage);
    if (selectedIndex < 0) return null;
    const number = startNumber + selectedIndex;
    const label = `${prefix}${formatPageNumber(number, numberFormat)}${suffix}`;
    const scaleFactor = size.displayWidth / Math.max(1, size.pageWidth);
    const marginPx = margin * scaleFactor;
    let sizePx = fontSize * scaleFactor;
    const maxWidth = Math.max(1, size.displayWidth - marginPx * 2);
    let width = measureText(label, sizePx, fontFamily);
    if (width > maxWidth) {
      sizePx = Math.max(1, sizePx * maxWidth / width);
      width = maxWidth;
    }
    const height = sizePx;
    const bounds = rotatedMarkBounds(width, height, 0);
    const layout = computeMarkLayout({
      displayWidth: size.displayWidth,
      displayHeight: size.displayHeight,
      position,
      align,
      valign: vertical,
      width: bounds.width,
      height: bounds.height,
      margin: marginPx,
    });
    const centerX = layout.left + bounds.width / 2;
    const centerY = size.displayHeight - layout.bottom - bounds.height / 2;
    const font = FONT_STACK[fontFamily];
    return (
      <span
        style={{
          position: "absolute",
          left: centerX - width / 2,
          top: centerY - height / 2,
          width,
          height,
          fontSize: sizePx,
          lineHeight: 1,
          fontFamily: font.family,
          fontWeight: font.weight,
          color,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    );
  };

  return (
    <section className="merge-panel pdf-tool" aria-labelledby="page-numbers-heading">
      <h2 id="page-numbers-heading">Add page numbers to a PDF on this device</h2>
      <p>Place sequential page labels on chosen pages. The starting number applies to the first selected page. The preview uses the same font, position, margin, and format as the PDF output.</p>
      <div className="privacy-note">PDFs up to {PDF_LIMITS.perFileBytes / 1024 / 1024} MB and {PDF_LIMITS.pages} pages. Processing runs in a browser worker and the output is reopened and validated before download.</div>
      <PdfDropzone label="Choose a PDF" hint="PDF only · up to 50 MB" disabled={busy} onFiles={(files) => void selectPdf(files[0])} />
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
            <label htmlFor="page-pages">Pages to update</label>
            <input id="page-pages" className="split-range-input" value={pagesText} disabled={busy} placeholder="All pages (default)" onChange={(event) => change(() => setPagesText(event.target.value))} aria-describedby="page-pages-help" />
            <p id="page-pages-help" className="route-note">Enter page numbers or ranges, such as 1-3, 5. Leave blank to use all pages.</p>
            <label className="pdf-check"><input type="checkbox" checked={skipCover} disabled={busy} onChange={(event) => change(() => { setSkipCover(event.target.checked); if (event.target.checked && previewPage === 1 && pageCount > 1) setPreviewPage(2); })} /> Skip first page</label>
            <label htmlFor="page-start">Starting number</label>
            <input id="page-start" type="number" min={0} max={999999} value={startNumber} disabled={busy} onChange={(event) => change(() => setStartNumber(Number(event.target.value)))} />
            <label htmlFor="page-format">Numbering format</label>
            <select id="page-format" className="split-range-input" value={numberFormat} disabled={busy} onChange={(event) => change(() => setNumberFormat(event.target.value as PageNumberFormat))}>
              {NUMBER_FORMATS.map((format) => <option key={format.value} value={format.value}>{format.label}</option>)}
            </select>
            <label htmlFor="page-prefix">Prefix</label>
            <input id="page-prefix" className="split-range-input" maxLength={80} value={prefix} disabled={busy} onChange={(event) => change(() => setPrefix(event.target.value))} />
            <label htmlFor="page-suffix">Suffix</label>
            <input id="page-suffix" className="split-range-input" maxLength={80} value={suffix} disabled={busy} onChange={(event) => change(() => setSuffix(event.target.value))} />
            <label htmlFor="page-font">Font</label>
            <select id="page-font" className="split-range-input" value={fontFamily} disabled={busy} onChange={(event) => change(() => setFontFamily(event.target.value as FontFamily))}>
              {FONT_FAMILIES.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
            </select>
            <label htmlFor="page-font-size">Font size</label>
            <input id="page-font-size" type="number" min={6} max={96} value={fontSize} disabled={busy} onChange={(event) => change(() => setFontSize(Number(event.target.value)))} />
            <label htmlFor="page-color">Text color</label>
            <div className="pdf-color-row">
              <input id="page-color" type="color" value={color} disabled={busy} onChange={(event) => change(() => setColor(event.target.value))} />
              <span>{color}</span>
            </div>
            <label htmlFor="page-position">Position</label>
            <select id="page-position" className="split-range-input" value={position} disabled={busy} onChange={(event) => change(() => { const [nextVertical, nextAlign] = event.target.value.split("-"); setVertical(nextVertical as "top" | "bottom"); setAlign(nextAlign as TextAlign); })}>
              {PAGE_POSITIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <label htmlFor="page-align">Alignment</label>
            <select id="page-align" className="split-range-input" value={align} disabled={busy} onChange={(event) => change(() => setAlign(event.target.value as TextAlign))}>
              <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
            </select>
            <label htmlFor="page-margin">Margin (points)</label>
            <input id="page-margin" type="number" min={0} max={200} value={margin} disabled={busy} onChange={(event) => change(() => setMargin(Number(event.target.value)))} />
            <p className="route-note">The engine keeps the number inside the page margins and reduces oversized text to prevent clipping.</p>
          </div>
          <PdfPagePreview document={document} pageNumber={safePreviewPage} overlay={previewOverlay} label={`Page-number preview · page ${safePreviewPage}`} />
          <PdfPageGrid document={document} pageCount={pageCount} mode="preview" previewPage={safePreviewPage} highlighted={pagesText.trim() || skipCover ? highlightedPages : undefined} onPreview={setPreviewPage} label="Choose a preview page" />
        </>
      ) : null}
      {file && document && rangeError ? <p role="alert" className="merge-error">{rangeError}</p> : null}
      <div className="merge-actions">
        <button type="button" className="hero-cta" disabled={!canProcess} onClick={() => void process()}>{busy ? "Updating PDF…" : "Add page numbers"}</button>
        {busy ? <button type="button" onClick={cancel}>Cancel</button> : null}
        {file && !busy ? <button type="button" onClick={clearAll}>Reset</button> : null}
      </div>
      {busy ? <PdfProgress label="Adding page numbers" value={progress?.completed} max={progress?.total} detail={progress?.label ?? "Preparing the browser worker…"} /> : null}
      {error ? <p role="alert" className="merge-error">{error}</p> : null}
      {result ? <PdfResult summary={`Validated numbered PDF · ${result.pages} pages`} downloads={[{ url: result.url, name: result.name }]} onReset={clearAll} /> : null}
    </section>
  );
}

