"use client";

import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS } from "@/lib/pdf-limits";
import { imageFormatFromSignature } from "@/lib/images-to-pdf";
import { safeFileStem } from "@/lib/pdf-images";
import type { MarkOptions } from "@/lib/pdf-marking";

type Operation = "watermark" | "page-number";
type Reply = { ok: boolean; output?: ArrayBuffer; error?: string };
const positions = ["center", "top-left", "top-right", "bottom-left", "bottom-right"] as const;
export default function PdfMarking({ operation }: { operation: Operation }) {
  const isWatermark = operation === "watermark";
  const [file, setFile] = useState<File | null>(null); const [imageFile, setImageFile] = useState<File | null>(null);
  const [text, setText] = useState(""); const [pages, setPages] = useState(""); const [position, setPosition] = useState<MarkOptions["position"]>("center");
  const [rotation, setRotation] = useState(315); const [opacity, setOpacity] = useState(0.25); const [fontSize, setFontSize] = useState(36);
  const [startNumber, setStartNumber] = useState(1); const [template, setTemplate] = useState("Page {n}");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [url, setUrl] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null); const urlRef = useRef<string | null>(null); const run = useRef(0); const mounted = useRef(false);
  const revoke = () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; setUrl(null); };
  const choosePdf = async (selected?: File) => {
    revoke(); setError(""); setFile(null); if (!selected) return;
    if (!selected.size || selected.size > PDF_LIMITS.perFileBytes) { setError("Choose a non-empty PDF under 50 MB."); return; }
    try { if (!checkPdfHeader(new Uint8Array(await selected.slice(0, 1024).arrayBuffer()))) { setError("This file does not have a PDF signature."); return; } setFile(selected); }
    catch { setError("Unable to read the selected PDF."); }
  };
  const chooseImage = async (selected?: File) => {
    setError(""); setImageFile(null); if (!selected) return;
    if (!selected.size || selected.size > 10 * 1024 * 1024) { setError("Choose a non-empty watermark image under 10 MB."); return; }
    try { const format = imageFormatFromSignature(new Uint8Array(await selected.slice(0, 8).arrayBuffer())); if (!format) { setError("Choose a valid PNG or JPG watermark image."); return; } setImageFile(selected); }
    catch { setError("Unable to read the watermark image."); }
  };
  const cancel = () => { run.current += 1; worker.current?.terminate(); worker.current = null; revoke(); setBusy(false); setError("Processing cancelled. Temporary browser data was released."); };
  const process = async () => {
    if (!file || busy) return; revoke(); setError(""); setBusy(true); const current = ++run.current;
    let pdfBytes: ArrayBuffer | null = null; let imageBytes: ArrayBuffer | null = null;
    try {
      pdfBytes = await file.arrayBuffer();
      if (current !== run.current) { if (pdfBytes.byteLength) new Uint8Array(pdfBytes).fill(0); return; }
      if (imageFile && isWatermark) imageBytes = await imageFile.arrayBuffer();
      if (current !== run.current) { if (pdfBytes.byteLength) new Uint8Array(pdfBytes).fill(0); if (imageBytes?.byteLength) new Uint8Array(imageBytes).fill(0); return; }
      const imageFormat = imageFile ? imageFormatFromSignature(new Uint8Array(imageBytes!).subarray(0, 8)) : undefined;
      const options: MarkOptions = { operation, text, pages: pages.trim() || "all", position, rotation, opacity, fontSize, startNumber, template, ...(imageBytes && imageFormat ? { image: { bytes: new Uint8Array(imageBytes), format: imageFormat } } : {}) };
      const active = new Worker(new URL("@/workers/pdf-marking.worker.ts", import.meta.url), { type: "module" }); worker.current = active;
      active.onmessage = async (event: MessageEvent<Reply>) => {
        active.terminate(); worker.current = null;
        if (current !== run.current || !mounted.current) { if (event.data.output?.byteLength) new Uint8Array(event.data.output).fill(0); return; }
        try {
          if (!event.data.ok || !event.data.output) throw new Error(event.data.error ?? "The PDF could not be updated.");
          if (!checkPdfHeader(new Uint8Array(event.data.output))) throw new Error("The generated file failed PDF signature validation.");
          const checked = await PDFDocument.load(event.data.output, { updateMetadata: false });
          if (checked.getPageCount() < 1 || checked.getPageCount() > PDF_LIMITS.pages) throw new Error("The generated PDF failed page-count validation.");
          if (current !== run.current || !mounted.current) return;
          const objectUrl = URL.createObjectURL(new Blob([event.data.output], { type: "application/pdf" })); urlRef.current = objectUrl; setUrl(objectUrl);
        } catch (reason) { if (current === run.current && mounted.current) setError(reason instanceof Error ? reason.message : "The updated PDF failed validation."); }
        finally { if (event.data.output?.byteLength) new Uint8Array(event.data.output).fill(0); if (current === run.current && mounted.current) setBusy(false); }
      };
      active.onerror = () => { active.terminate(); worker.current = null; if (current === run.current && mounted.current) { setBusy(false); setError("PDF processing stopped unexpectedly."); } };
      const transfer: Transferable[] = [pdfBytes]; if (imageBytes) transfer.push(imageBytes);
      active.postMessage({ bytes: pdfBytes, options }, transfer); pdfBytes = null; imageBytes = null;
    } catch (reason) {
      if (current === run.current && mounted.current) { setBusy(false); setError(reason instanceof Error ? reason.message : "Unable to process the PDF."); }
    } finally {
      if (pdfBytes?.byteLength) new Uint8Array(pdfBytes).fill(0);
      if (imageBytes?.byteLength) new Uint8Array(imageBytes).fill(0);
    }
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; run.current += 1; worker.current?.terminate(); if (urlRef.current) URL.revokeObjectURL(urlRef.current); }; }, []);
  const heading = isWatermark ? "Add a watermark to a PDF on this device" : "Add page numbers to a PDF on this device";
  return <section className="merge-panel" aria-labelledby="pdf-marking-heading"><h2 id="pdf-marking-heading">{heading}</h2><p>{isWatermark ? "Add a text or PNG/JPG image mark to chosen pages. This overlays content; it is not a secure redaction. Text uses a standard Helvetica font with limited glyph coverage." : "Place sequential page labels on chosen pages. The starting number applies to the first selected page. Text uses a standard Helvetica font with limited glyph coverage."}</p><div className="privacy-note">PDFs up to 50 MB and 500 pages are processed in a worker on this device. A downloaded output appears only after it is reopened and validated.</div><label className="file-picker">Choose a PDF<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => { void choosePdf(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label>{file && <div className="split-settings"><p><strong>{file.name}</strong></p><label htmlFor="mark-pages">Pages to update</label><input id="mark-pages" className="split-range-input" value={pages} disabled={busy} placeholder="All pages (default)" onChange={(event) => setPages(event.target.value)} aria-describedby="mark-pages-help"/><p id="mark-pages-help" className="route-note">Enter page numbers or ranges, such as 1-3, 5. Leave blank to use all pages.</p>{isWatermark ? <><label htmlFor="mark-text">Watermark text</label><input id="mark-text" className="split-range-input" maxLength={160} value={text} disabled={busy} onChange={(event) => setText(event.target.value)}/><label className="file-picker">Optional PNG/JPG watermark image<input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" disabled={busy} onChange={(event) => { void chooseImage(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label>{imageFile && <p>{imageFile.name} · {(imageFile.size / 1024).toFixed(1)} KB</p>}</> : <><label htmlFor="mark-start">Starting number</label><input id="mark-start" type="number" min={0} max={999999} value={startNumber} disabled={busy} onChange={(event) => setStartNumber(Number(event.target.value))}/><label htmlFor="mark-template">Number format</label><input id="mark-template" className="split-range-input" maxLength={80} value={template} disabled={busy} onChange={(event) => setTemplate(event.target.value)}/><p className="route-note">Use {'{n}'} where the number should appear.</p></>}
      <label htmlFor="mark-position">Position</label><select id="mark-position" className="split-range-input" value={position} disabled={busy} onChange={(event) => setPosition(event.target.value as typeof position)}>{positions.map((value) => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}</select><label htmlFor="mark-rotation">Rotation (degrees)</label><input id="mark-rotation" type="number" min={0} max={359} value={rotation} disabled={busy} onChange={(event) => setRotation(Number(event.target.value))}/><label htmlFor="mark-opacity">Opacity</label><input id="mark-opacity" type="range" min={0.05} max={1} step={0.05} value={opacity} disabled={busy} onChange={(event) => setOpacity(Number(event.target.value))}/><span>{Math.round(opacity * 100)}%</span><label htmlFor="mark-font-size">Font size</label><input id="mark-font-size" type="number" min={6} max={96} value={fontSize} disabled={busy} onChange={(event) => setFontSize(Number(event.target.value))}/></div>}
    <div className="merge-actions"><button type="button" className="hero-cta" disabled={!file || busy} onClick={() => void process()}>{busy ? "Updating PDF…" : isWatermark ? "Add watermark" : "Add page numbers"}</button>{busy && <button type="button" onClick={cancel}>Cancel</button>}</div>{error && <p role="alert" className="merge-error">{error}</p>}{url && <p role="status" className="merge-success"><a href={url} download={`${safeFileStem(file?.name ?? "document")}-${isWatermark ? "watermarked" : "numbered"}.pdf`}>Download validated PDF</a></p>}</section>;
}
