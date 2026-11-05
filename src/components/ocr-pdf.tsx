"use client";

import { useRef, useState } from "react";
import { checkPdfHeader } from "@/lib/pdf-limits";
import { OCR_PDF_LIMITS, formatOcrPages, mergeOcrLines, parsePageSelection } from "@/lib/pdf-ocr";

type Status = "idle" | "running" | "done" | "error";

export default function OcrPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [pageInput, setPageInput] = useState("");
  const [totalPages, setTotalPages] = useState(0);
  const [text, setText] = useState("");
  const [progress, setProgress] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const cancelRef = useRef(false);

  const pick = async (selected: File | undefined) => {
    setFile(null); setText(""); setTotalPages(0); setPageInput(""); setStatus("idle"); setMessage("");
    if (!selected) return;
    if (!selected.size) { setStatus("error"); setMessage("That file is empty."); return; }
    if (selected.size > OCR_PDF_LIMITS.maxFileBytes) { setStatus("error"); setMessage("Choose a PDF under 25 MB."); return; }
    const head = new Uint8Array(await selected.slice(0, 1024).arrayBuffer());
    if (!checkPdfHeader(head)) { setStatus("error"); setMessage("This file does not have a PDF signature."); return; }
    setFile(selected);
  };

  const cancel = () => {
    cancelRef.current = true;
    setProgress("Cancelling after the current page…");
  };

  const run = async () => {
    if (!file) return;
    setStatus("running"); setText(""); setMessage(""); cancelRef.current = false;
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    try {
      setProgress("Opening the PDF…");
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const data = new Uint8Array(await file.arrayBuffer());
      loadingTask = pdfjs.getDocument({ data });
      const pdf = await (loadingTask as unknown as { promise: Promise<import("pdfjs-dist").PDFDocumentProxy> }).promise;
      setTotalPages(pdf.numPages);

      let pages: number[];
      try {
        pages = parsePageSelection(pageInput, pdf.numPages);
      } catch (reason) {
        setStatus("error");
        setMessage(reason instanceof Error ? reason.message : "Choose valid pages.");
        return;
      }

      setProgress("Loading the OCR engine (first run downloads about 15 MB)…");
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      try {
        const results: { page: number; text: string }[] = [];
        for (const [index, pageNumber] of pages.entries()) {
          if (cancelRef.current) break;
          setProgress(`Rendering page ${pageNumber} (${index + 1} of ${pages.length})…`);
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: OCR_PDF_LIMITS.defaultScale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("This browser could not provide a drawing canvas for page rendering.");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          setProgress(`Recognising text on page ${pageNumber} (${index + 1} of ${pages.length})…`);
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
          canvas.width = 0; canvas.height = 0; page.cleanup();
          if (!blob) throw new Error(`Page ${pageNumber} could not be rendered to an image.`);
          const recognised = await worker.recognize(blob);
          results.push({ page: pageNumber, text: mergeOcrLines(recognised.data.text) });
        }
        const output = formatOcrPages(results);
        setText(output);
        setStatus("done");
        setProgress(cancelRef.current ? "Cancelled — partial results are shown below." : `Finished ${results.length} page(s).`);
      } finally {
        await worker.terminate().catch(() => undefined);
      }
    } catch (reason) {
      setStatus("error");
      setMessage(reason instanceof Error ? reason.message : "OCR failed. Try a smaller page range.");
    } finally {
      if (loadingTask) { try { await loadingTask.destroy(); } catch { /* already destroyed */ } }
    }
  };

  const download = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(file?.name ?? "document").replace(/\.pdf$/i, "")}-ocr.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const busy = status === "running";

  return (
    <section className="ocr" aria-label="OCR PDF">
      <p>Recognise text inside scanned or image-only PDFs. Pages are rendered and read in this browser with Tesseract; nothing is uploaded.</p>
      <div className="privacy-note">
        Limit: {OCR_PDF_LIMITS.maxPagesPerRun} pages per run, 25 MB per PDF. Leave pages empty to start from page 1. The first run downloads the English OCR model (about 15 MB).
      </div>
      <label className="file-picker">
        Choose a PDF to OCR
        <input
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(event) => { void pick(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}
        />
      </label>
      <div className="ocr__controls">
        <label htmlFor="ocr-pages">Pages</label>
        <input
          id="ocr-pages"
          type="text"
          value={pageInput}
          placeholder="all (or 1-3,7)"
          disabled={busy}
          onChange={(event) => setPageInput(event.target.value)}
        />
        <button type="button" className="hero-cta" disabled={!file || busy} onClick={() => void run()}>
          {busy ? "Recognising…" : "Extract text"}
        </button>
        {busy && <button type="button" onClick={cancel}>Cancel</button>}
        {totalPages > 0 && <span className="ocr__message">{totalPages} page(s) in the document</span>}
      </div>
      {progress && <p role="status" aria-live="polite" className="ocr__message">{progress}</p>}
      {message && <p role="alert" className="ocr__message">{message}</p>}
      {text && (
        <>
          <label htmlFor="ocr-pdf-output">Recognised text</label>
          <textarea id="ocr-pdf-output" className="ocr__output" readOnly value={text} rows={12} />
          <div className="ocr__controls">
            <button type="button" onClick={download}>Download .txt</button>
            <button type="button" onClick={() => { void navigator.clipboard.writeText(text).catch(() => undefined); }}>Copy text</button>
            <span className="ocr__message">{text.length.toLocaleString()} characters</span>
          </div>
        </>
      )}
    </section>
  );
}
