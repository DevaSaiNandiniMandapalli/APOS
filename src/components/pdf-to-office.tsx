"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { loadPdfPreview } from "@/lib/pdf-preview";
import { extractPdfStructure, type PdfStructureMetadata } from "@/lib/pdf-structured";
import { convertPdfToOffice, type PdfOfficeFormat, type PdfOfficeMode, type PdfOfficeResult } from "@/lib/pdf-to-office";
import { fetchServerRegistry, runServerPdfToWord, type ServerTool } from "@/lib/server-tools";

type Analysis = {
  pageCount: number;
  thumbnail: string;
  width: number;
  height: number;
  pagesAnalysed: number;
  headings: number;
  paragraphs: number;
  tables: number;
  emptyPages: number[];
  preview: string;
  metadata: PdfStructureMetadata;
};

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/^[.\- ]+|[.\- ]+$/g, "").slice(0, 80) || "document";
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function PdfToOffice() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<PdfOfficeFormat>("docx");
  const [mode, setMode] = useState<PdfOfficeMode>("editable");
  const [engine, setEngine] = useState<"browser" | "server">("browser");
  const [serverTool, setServerTool] = useState<ServerTool | null>(null);
  const [serverOcrAvailable, setServerOcrAvailable] = useState(false);
  const [serverChecked, setServerChecked] = useState(false);
  const [serverOcr, setServerOcr] = useState(false);
  const [serverLanguage, setServerLanguage] = useState("eng");
  const [pageMode, setPageMode] = useState<"all" | "custom">("all");
  const [pageRange, setPageRange] = useState("");
  const [includeTables, setIncludeTables] = useState(true);
  const [includePictures, setIncludePictures] = useState(true);
  const [pageBreaks, setPageBreaks] = useState(true);
  const [ocrScannedPages, setOcrScannedPages] = useState(false);
  const [outputName, setOutputName] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [result, setResult] = useState<(PdfOfficeResult & { url: string }) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const clearResult = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setResult(null);
  };

  const analyse = async (selected: File) => {
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setAnalysing(true);
    setAnalysis(null);
    try {
      const preview = await loadPdfPreview(selected);
      if (controller.signal.aborted) { await preview.destroy(); return; }
      try {
        const thumbnail = await preview.renderPage(1, 220, "jpeg");
        const pages = preview.pageCount;
        const previewRange = pages <= 5 ? `1-${pages}` : "1-5";
        const structure = await extractPdfStructure(selected, {
          pages: previewRange,
          signal: controller.signal,
          onProgress: () => undefined,
          includeMetadata: true,
        });
        if (controller.signal.aborted) return;
        let headings = 0;
        let paragraphs = 0;
        let tables = 0;
        for (const page of structure.pages) {
          for (const block of page.blocks) {
            if (block.kind === "heading") headings += 1;
            else if (block.kind === "table") tables += 1;
            else paragraphs += 1;
          }
        }
        setAnalysis({
          pageCount: pages,
          thumbnail: thumbnail.dataUrl,
          width: thumbnail.width,
          height: thumbnail.height,
          pagesAnalysed: structure.pages.length,
          headings,
          paragraphs,
          tables,
          emptyPages: structure.emptyPages,
          preview: structure.text.slice(0, 12000),
          metadata: structure.metadata,
        });
      } finally {
        await preview.destroy();
      }
    } catch (reason) {
      if (!controller.signal.aborted && mountedRef.current) {
        setError(reason instanceof Error ? reason.message : "This PDF could not be analysed.");
      }
    } finally {
      if (mountedRef.current && previewAbortRef.current === controller) {
        setAnalysing(false);
        previewAbortRef.current = null;
      }
    }
  };

  const selectFile = async (selected: File | undefined) => {
    if (!selected || busy) return;
    clearResult();
    setError("");
    setErrorCode("");
    setProgress("");
    setAnalysis(null);
    previewAbortRef.current?.abort();
    if (!selected.size) { setFile(null); setError("That file is empty."); return; }
    if (selected.size > 25 * 1024 * 1024) { setFile(null); setError("Choose a PDF under 25 MB."); return; }
    try {
      const head = new Uint8Array(await selected.slice(0, 1024).arrayBuffer());
      if (String.fromCharCode(...head.subarray(0, 5)) !== "%PDF-") {
        setFile(null);
        setError("This file does not have a PDF signature.");
        return;
      }
    } catch {
      setFile(null);
      setError("The selected file could not be read.");
      return;
    }
    setFile(selected);
    setOutputName(baseName(selected.name));
    setPageMode("all");
    setPageRange("");
    void analyse(selected);
  };

  const run = async (ocrOverride?: boolean) => {
    if (!file || busy) return;
    clearResult();
    setError("");
    setErrorCode("");
    setBusy(true);
    setProgress("Preparing…");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const pages = pageMode === "custom" ? pageRange : "";
      if (format === "docx" && mode === "editable" && engine === "server") {
        if (!serverTool) throw new Error("The layout-preserving Word engine is not available on the configured server.");
        if (serverOcr && !serverOcrAvailable) throw new Error("OCR is not available on this processing server. Install OCRmyPDF and Tesseract, or turn OCR off.");
        setProgress("Uploading to your APOS processing server…");
        const output = await runServerPdfToWord(file, {
          pages,
          ocr: serverOcr,
          language: serverLanguage,
        }, controller.signal);
        if (controller.signal.aborted || !mountedRef.current) return;
        const blobUrl = URL.createObjectURL(output.blob);
        urlRef.current = blobUrl;
        const fileName = `${baseName(outputName || file.name)}.docx`;
        setResult({
          bytes: new Uint8Array(0),
          fileName,
          mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          detail: `Layout-preserving Word document generated on your APOS processing server${serverOcr ? " with OCR" : ""}. Complex layouts, unusual fonts and merged cells may still need review.`,
          stats: {
            pages: analysis?.pageCount ?? 0,
            textPages: 0,
            scannedPages: 0,
            blankPages: 0,
            ocrPages: serverOcr ? 1 : 0,
            paragraphs: 0,
            headings: 0,
            tables: 0,
            pictures: 0,
            skippedFullPageImages: 0,
            unplacedImages: 0,
            warnings: ["This document was processed on the self-hosted APOS server, not in this browser.", "Layout-preserving conversion is an approximation; review the result before publishing."],
          },
          url: blobUrl,
        });
        setProgress("Done.");
        return;
      }
      const output = await convertPdfToOffice(file, {
        format,
        mode,
        pages,
        includeTables,
        includePictures,
        pageBreaks,
        ocrScannedPages: ocrOverride ?? ocrScannedPages,
        outputName,
      }, {
        signal: controller.signal,
        onProgress: (message) => { if (mountedRef.current) setProgress(message); },
      });
      if (controller.signal.aborted || !mountedRef.current) return;
      const blob = new Blob([output.bytes as unknown as BlobPart], { type: output.mime });
      output.bytes.fill(0);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setResult({ ...output, url });
      setProgress("Done.");
    } catch (reason) {
      if (controller.signal.aborted) setError("Conversion cancelled.");
      else {
        const code = reason && typeof reason === "object" && "code" in reason ? String((reason as { code?: unknown }).code ?? "") : "";
        setErrorCode(code);
        setError(reason instanceof Error ? reason.message : "The conversion failed.");
      }
      setProgress("");
    } finally {
      if (mountedRef.current) setBusy(false);
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setProgress("Cancelling…");
  };

  const reset = () => {
    if (busy) return;
    previewAbortRef.current?.abort();
    clearResult();
    setFile(null);
    setAnalysis(null);
    setError("");
    setErrorCode("");
    setProgress("");
    setOutputName("");
    setPageMode("all");
    setPageRange("");
    setOcrScannedPages(false);
    setServerOcr(false);
    setEngine("browser");
    if (inputRef.current) inputRef.current.value = "";
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      previewAbortRef.current?.abort();
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchServerRegistry(controller.signal)
      .then((registry) => {
        const tool = registry.tools.find((candidate) => candidate.name === "pdf_to_word") ?? null;
        setServerTool(tool?.available ? tool : null);
        setServerOcrAvailable(Boolean(registry.tools.find((candidate) => candidate.name === "ocr")?.available));
        setServerChecked(true);
      })
      .catch(() => {
        setServerTool(null);
        setServerChecked(true);
      });
    return () => controller.abort();
  }, []);

  const pageSelectionError = (() => {
    if (!analysis || pageMode !== "custom") return "";
    try {
      const parts = pageRange.split(",").map((part) => part.trim()).filter(Boolean);
      if (!parts.length) return "Enter at least one page or range, such as 1-3, 5.";
      for (const part of parts) {
        const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
        if (!match) return "Use page numbers or ranges, such as 1-3, 5.";
        const first = Number(match[1]);
        const last = Number(match[2] ?? match[1]);
        if (first < 1 || last < first || last > analysis.pageCount) return `Page range ${part} is outside this document's 1-${analysis.pageCount} pages.`;
      }
      return "";
    } catch {
      return "That page selection could not be read.";
    }
  })();

  return <section className="office-convert" aria-labelledby="pdf-office-heading">
    <h2 id="pdf-office-heading">Convert a PDF to editable Word or Excel</h2>
    <p>Editable Word rebuilds selectable text, headings, paragraphs, detected tables and content pictures. The optional layout-preserving engine uses the self-hosted APOS processing server for closer Word fidelity. Visual Word places each PDF page in the document as a picture and is not editable.</p>
    <div className="privacy-note">{format === "docx" && mode === "editable" && engine === "server"
      ? "Layout-preserving mode uploads this PDF to the configured APOS processing server. That server handles the file in memory or a temporary directory, uses no database, and does not keep it permanently. Browser-local mode remains available and never uploads."
      : "The PDF is read in this browser. Nothing is uploaded. The converter accepts PDFs up to 25 MB and 500 pages. Image-only pages are detected individually: enable OCR to convert them to editable text, or use Visual Word for an image-based copy."}</div>

    <label className="file-picker">Choose a file
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => { void selectFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
    </label>
    <div
      className={`drop-zone${dragActive ? " drop-active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => { if (!busy) inputRef.current?.click(); }}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!busy) inputRef.current?.click(); } }}
      onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragActive(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
      onDrop={(event) => { event.preventDefault(); setDragActive(false); if (!busy) void selectFile(event.dataTransfer.files?.[0]); }}
    >Drop a PDF here, or use the file picker above.</div>

    {file && <div className="office-convert__file" role="status">
      <strong>{file.name}</strong>
      <span>{formatBytes(file.size)}</span>
      {analysing && <span>Reading PDF information…</span>}
    </div>}

    {analysis && <section className="office-preview" aria-labelledby="office-preview-heading">
      <div className="office-preview__media">
        <img src={analysis.thumbnail} alt={`Preview of page 1 of ${file?.name ?? "the PDF"}`} width={analysis.width} height={analysis.height} />
      </div>
      <div className="office-preview__copy">
        <h3 id="office-preview-heading">Document preview</h3>
        <dl className="office-stats">
          <div><dt>Pages</dt><dd>{analysis.pageCount}</dd></div>
          <div><dt>Analysed</dt><dd>{analysis.pagesAnalysed} page(s)</dd></div>
          <div><dt>Headings</dt><dd>{analysis.headings}</dd></div>
          <div><dt>Paragraphs</dt><dd>{analysis.paragraphs}</dd></div>
          <div><dt>Tables</dt><dd>{analysis.tables}</dd></div>
        </dl>
        {analysis.metadata.title && <p className="office-preview__meta">PDF title: {analysis.metadata.title}</p>}
        {analysis.emptyPages.length > 0 && <p className="office-convert__warning" role="status">{analysis.emptyPages.length} of the previewed page(s) have no selectable text. Scanned pages require OCR.</p>}
        {analysis.pageCount > analysis.pagesAnalysed && <p className="route-note">The preview analyses the first {analysis.pagesAnalysed} pages. Conversion covers the page range you choose below.</p>}
        <details className="office-preview__text">
          <summary>Show extracted preview</summary>
          <pre>{analysis.preview || "No selectable text was found in the previewed pages."}</pre>
        </details>
      </div>
    </section>}

    {file && <div className="office-options">
      <fieldset className="conversion-options">
        <legend>Output</legend>
        <label>Format
          <select value={format} disabled={busy} onChange={(event) => setFormat(event.target.value as PdfOfficeFormat)}>
            <option value="docx">Microsoft Word (.docx)</option>
            <option value="xlsx">Microsoft Excel (.xlsx)</option>
          </select>
        </label>
        {format === "docx" && <label>Word mode
          <select value={mode} disabled={busy} onChange={(event) => setMode(event.target.value as PdfOfficeMode)}>
            <option value="editable">Editable Word — text and tables, pictures kept at source positions</option>
            <option value="visual">Exact layout — every page as a picture (not editable)</option>
          </select>
        </label>}
        {format === "docx" && mode === "editable" && <p className="route-note">Pictures are anchored at their original page coordinates. Text may reflow when edited. For a page-for-page visual match, choose Exact layout.</p>}
        {format === "docx" && mode === "editable" && <label>Word engine
          <select aria-label="Word engine" value={engine} disabled={busy} onChange={(event) => setEngine(event.target.value as "browser" | "server")}>
            <option value="browser">Browser-local — private, structured reconstruction</option>
            {serverTool && <option value="server">Layout-preserving server — higher Word fidelity</option>}
          </select>
          {!serverChecked && <span className="route-note">Checking the optional processing server…</span>}
          {serverChecked && !serverTool && <span className="route-note">The layout-preserving engine is not configured or unavailable. <Link className="text-link" href="/server-tools">Check server tools</Link>.</span>}
        </label>}
        <label>Pages
          <select aria-label="Pages" value={pageMode} disabled={busy} onChange={(event) => setPageMode(event.target.value as "all" | "custom")}>
            <option value="all">All pages</option>
            <option value="custom">Custom page range</option>
          </select>
        </label>
        {pageMode === "custom" && <label>Page range
          <input aria-label="Page range" value={pageRange} disabled={busy} onChange={(event) => setPageRange(event.target.value)} placeholder="1-3, 5" aria-describedby="office-range-help" aria-invalid={Boolean(pageSelectionError)} />
          <span id="office-range-help" className="route-note">Use page numbers or ranges, such as 1-3, 5.</span>
        </label>}
        {pageSelectionError && <p className="merge-error" role="alert">{pageSelectionError}</p>}
        {format === "docx" && mode === "editable" && engine === "browser" && <>
          <label className="office-check"><input type="checkbox" checked={includeTables} disabled={busy} onChange={(event) => setIncludeTables(event.target.checked)} /> Keep detected tables as Word tables</label>
          <label className="office-check"><input type="checkbox" checked={includePictures} disabled={busy} onChange={(event) => setIncludePictures(event.target.checked)} /> Include content pictures (never full-page scans or backgrounds)</label>
          <label className="office-check"><input type="checkbox" checked={pageBreaks} disabled={busy} onChange={(event) => setPageBreaks(event.target.checked)} /> Keep PDF page boundaries and source page sizes</label>
          <label className="office-check"><input type="checkbox" checked={ocrScannedPages} disabled={busy} onChange={(event) => setOcrScannedPages(event.target.checked)} /> OCR image-only pages (English, slower; first use downloads the model)</label>
          <p className="route-note">If image-only pages are found and OCR is off, conversion stops with the affected page numbers. It never inserts screenshots into Editable Word.</p>
        </>}
        {format === "docx" && mode === "editable" && engine === "server" && <>
          <label className="office-check"><input type="checkbox" checked={serverOcr} disabled={busy || !serverOcrAvailable} onChange={(event) => setServerOcr(event.target.checked)} /> OCR scanned pages on the server</label>
          {!serverOcrAvailable && <p className="route-note">Server OCR needs OCRmyPDF and Tesseract. Text PDFs can still use layout conversion.</p>}
          {serverOcr && <label>OCR language
            <select value={serverLanguage} disabled={busy} onChange={(event) => setServerLanguage(event.target.value)}>
              <option value="eng">English</option>
              <option value="hin">Hindi</option>
              <option value="deu">German</option>
              <option value="fra">French</option>
              <option value="spa">Spanish</option>
            </select>
          </label>}
          <p className="route-note">The server uses a layout-reconstruction engine. It generally preserves columns, tables and styling better than browser text extraction, but pictures and complex layouts may still be repositioned. For a pixel-identical page appearance, choose Exact layout.</p>
        </>}
        {format === "xlsx" && <p className="route-note">Each detected table becomes a worksheet; an extracted-text worksheet is always included. Cell values are written as text, not formulas.</p>}
        <label>Output filename
          <input value={outputName} disabled={busy} onChange={(event) => setOutputName(event.target.value)} aria-label="Output filename" />
        </label>
      </fieldset>
    </div>}

    <div className="merge-actions">
      <button type="button" className="hero-cta" disabled={!file || busy || analysing || Boolean(pageSelectionError)} onClick={() => void run()}>{busy ? "Converting…" : "Convert PDF"}</button>
      {busy && <button type="button" onClick={cancel}>Cancel</button>}
      {file && !busy && <button type="button" onClick={reset}>Start over</button>}
    </div>
    {progress && <p role="status" aria-live="polite">{progress}</p>}
    {error && <p role="alert" className="merge-error">{error}</p>}
    {errorCode === "scanned-pages" && <div className="merge-actions">
      <button type="button" className="hero-cta" onClick={() => { setOcrScannedPages(true); void run(true); }}>Enable OCR and retry</button>
      <button type="button" onClick={() => { setMode("visual"); setError(""); setErrorCode(""); }}>Use Visual Word instead</button>
    </div>}
    {errorCode === "scanned-pages" && <p className="route-note">You can also <Link className="text-link" href="/tools/ocr-pdf">extract text with OCR PDF</Link> separately, but this converter can OCR the affected pages directly.</p>}

    {result && <div role="status" className="merge-success office-result">
      <p>{result.detail}</p>
      {result.stats.warnings.map((warning) => <p className="office-convert__warning" key={warning}>{warning}</p>)}
      {result.stats.ocrPages > 0 && <p className="route-note">OCR text is editable but may contain recognition errors. Review it before publishing.</p>}
      <a className="hero-cta" href={result.url} download={result.fileName}>Download {result.fileName}</a>
      <button type="button" onClick={reset}>Convert another PDF</button>
    </div>}
  </section>;
}
