"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
import { checkPdfHeader, PDF_LIMITS } from "@/lib/pdf-limits";
import { redactPdf, type RedactionBox } from "@/lib/pdf-security-tools";
import { safeFileStem } from "@/lib/pdf-images";

type LocalBox = { id: number; x: number; y: number; width: number; height: number };

export default function RedactPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [boxes, setBoxes] = useState<RedactionBox[]>([]);
  const [current, setCurrent] = useState<LocalBox[]>([]);
  const [size, setSize] = useState({ width: 612, height: 792 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingRef = useRef<PDFDocumentLoadingTask | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const urlRef = useRef<string | null>(null);
  const nextId = useRef(1);

  const clear = () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; setUrl(null); };

  const renderPage = async (doc: PDFDocumentProxy, index: number) => {
    const pdfPage = await doc.getPage(index);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const scale = Math.min(1.4, 900 / viewport.width);
    const scaled = pdfPage.getViewport({ scale });
    canvas.width = Math.floor(scaled.width);
    canvas.height = Math.floor(scaled.height);
    canvas.style.width = "100%";
    await pdfPage.render({ canvas, canvasContext: context, viewport: scaled }).promise;
    setSize({ width: viewport.width, height: viewport.height });
    setCurrent(boxes.filter((box) => box.page === index).map((box, offset) => ({ id: offset, ...box })));
  };

  const choose = async (selected?: File) => {
    clear(); setError(""); setFile(null); setBoxes([]); setCurrent([]);
    if (!selected) return;
    if (!selected.size) { setError("The selected file is empty."); return; }
    if (selected.size > PDF_LIMITS.perFileBytes) { setError("The PDF exceeds the 50 MB input limit."); return; }
    const head = new Uint8Array(await selected.slice(0, 1024).arrayBuffer());
    if (!checkPdfHeader(head)) { setError("This file does not have a PDF signature."); return; }
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const loading = pdfjs.getDocument({ data: new Uint8Array(await selected.arrayBuffer()) });
      loadingRef.current = loading;
      const doc = await loading.promise;
      docRef.current = doc;
      setPages(doc.numPages);
      setPage(1);
      setFile(selected);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await renderPage(doc, 1);
    } catch { setError("This PDF could not be opened. It may be encrypted or damaged."); }
  };

  const pointToPage = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * size.width;
    const y = ((event.clientY - rect.top) / rect.height) * size.height;
    return { x: Math.max(0, Math.min(size.width, x)), y: Math.max(0, Math.min(size.height, y)) };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!file) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = pointToPage(event);
    clear();
  };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const start = dragRef.current;
    dragRef.current = null;
    if (!start) return;
    const end = pointToPage(event);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    if (width < 6 || height < 6) return;
    const box: RedactionBox = { page, x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height };
    setBoxes((list) => [...list, box]);
    setCurrent((list) => [...list, { id: nextId.current++, ...box }]);
  };

  const goTo = async (index: number) => {
    if (!docRef.current) return;
    const target = Math.min(pages, Math.max(1, index));
    setPage(target);
    await renderPage(docRef.current, target);
  };

  const run = async () => {
    if (!file) return;
    clear(); setError("");
    if (!boxes.length) { setError("Draw at least one redaction box on the preview."); return; }
    setBusy(true);
    try {
      const bytes = await redactPdf(file, boxes, { onProgress: () => undefined });
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).slice().buffer as ArrayBuffer], { type: "application/pdf" }));
      urlRef.current = url; setUrl(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The PDF could not be redacted."); }
    finally { setBusy(false); }
  };

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    if (docRef.current) void docRef.current.cleanup();
    if (loadingRef.current) void loadingRef.current.destroy();
  }, []);

  return <section className="merge-panel" aria-labelledby="redact-heading">
    <h2 id="redact-heading">Redact a PDF on this device</h2>
    <p>Drag boxes over anything that must disappear. Pages you mark are rebuilt as images with the covered areas burned in, so the text underneath is genuinely gone.</p>
    <div className="privacy-note">Pages without boxes keep their text layer. The file never leaves this device.</div>
    <label className="file-picker">Choose a PDF<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => { void choose(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label>
    {file && <div className="split-settings">
      <p><strong>{file.name}</strong> · {boxes.length} box(es)</p>
      <div className="redact-nav">
        <button type="button" onClick={() => void goTo(page - 1)} disabled={page <= 1 || busy}>Previous page</button>
        <span>Page {page} of {pages}</span>
        <button type="button" onClick={() => void goTo(page + 1)} disabled={page >= pages || busy}>Next page</button>
      </div>
      <div className="redact-stage">
        <canvas ref={canvasRef} className="redact-canvas" onPointerDown={onPointerDown} onPointerUp={onPointerUp} aria-label="Redaction preview. Drag to mark an area."/>
        <div className="redact-overlay" aria-hidden="true">
          {current.map((box) => (
            <span key={box.id} style={{ left: `${(box.x / size.width) * 100}%`, top: `${(box.y / size.height) * 100}%`, width: `${(box.width / size.width) * 100}%`, height: `${(box.height / size.height) * 100}%` }}/>
          ))}
        </div>
      </div>
      <div className="redact-nav">
        <button type="button" onClick={() => { setBoxes((list) => list.slice(0, -1)); setCurrent((list) => list.slice(0, -1)); }} disabled={!boxes.length || busy}>Undo last box</button>
        <button type="button" onClick={() => { setBoxes((list) => list.filter((box) => box.page !== page)); setCurrent([]); }} disabled={!current.length || busy}>Clear this page</button>
      </div>
    </div>}
    <div className="merge-actions"><button type="button" className="hero-cta" disabled={!file || busy || !boxes.length} onClick={() => void run()}>{busy ? "Redacting…" : "Redact PDF"}</button></div>
    {error && <p role="alert" className="merge-error">{error}</p>}
    {url && <p role="status" className="merge-success"><a href={url} download={`${safeFileStem(file?.name ?? "document")}-redacted.pdf`}>Download redacted PDF</a></p>}
  </section>;
}
