"use client";

import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "@cantoo/pdf-lib";
import { PDF_LIMITS, checkPdfHeader } from "@/lib/pdf-limits";
import { imageFormatFromSignature, IMAGES_TO_PDF_LIMITS, validateImageBatch } from "@/lib/images-to-pdf";

type Reply = { ok: boolean; bytes?: ArrayBuffer; error?: string };
export default function ImagesToPdf() {
  const [files, setFiles] = useState<File[]>([]); const [size, setSize] = useState<"image" | "a4" | "letter">("a4"); const [orientation, setOrientation] = useState<"auto" | "portrait" | "landscape">("auto");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [url, setUrl] = useState<string | null>(null); const worker = useRef<Worker | null>(null); const urlRef = useRef<string | null>(null); const run = useRef(0); const mounted = useRef(false);
  const clear = () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; setUrl(null); };
  const choose = async (incoming: FileList | null) => {
    clear(); setError(""); if (!incoming) return;
    const next = Array.from(incoming);
    try { validateImageBatch(next.map((file) => file.size)); }
    catch (reason) { setFiles([]); setError(reason instanceof Error ? reason.message : "The image selection exceeds the supported limits."); return; }
    for (const file of next) {
      const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      if (!imageFormatFromSignature(head)) { setFiles([]); setError(`${file.name} is not a supported PNG or JPG image.`); return; }
    }
    setFiles(next);
  };
  const move = (index: number, direction: -1 | 1) => setFiles((current) => { const target = index + direction; if (target < 0 || target >= current.length) return current; const changed = [...current]; [changed[index], changed[target]] = [changed[target], changed[index]]; return changed; });
  const cancel = () => { run.current += 1; worker.current?.terminate(); worker.current = null; clear(); setBusy(false); setError("Processing cancelled. Temporary browser data was released."); };
  const process = async () => {
    if (!files.length || busy) return; clear(); setError(""); setBusy(true); const current = ++run.current;
    try {
      const payload = await Promise.all(files.map(async (file) => ({ name: file.name, bytes: await file.arrayBuffer() })));
      if (current !== run.current) { payload.forEach(({ bytes }) => new Uint8Array(bytes).fill(0)); return; }
      const active = new Worker(new URL("@/workers/images-to-pdf.worker.ts", import.meta.url), { type: "module" }); worker.current = active;
      active.onmessage = async (event: MessageEvent<Reply>) => {
        active.terminate(); worker.current = null;
        if (current !== run.current || !mounted.current) { if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0); return; }
        try {
          if (!event.data.ok || !event.data.bytes) throw new Error(event.data.error ?? "The PDF could not be created.");
          if (event.data.bytes.byteLength > PDF_LIMITS.perFileBytes || !checkPdfHeader(new Uint8Array(event.data.bytes))) throw new Error("The generated PDF failed validation or exceeds the 50 MB output limit.");
          const checked = await PDFDocument.load(event.data.bytes); if (checked.getPageCount() !== files.length) throw new Error("The generated PDF did not contain all selected images.");
          if (current !== run.current || !mounted.current) return;
          const objectUrl = URL.createObjectURL(new Blob([event.data.bytes], { type: "application/pdf" })); urlRef.current = objectUrl; setUrl(objectUrl);
        } catch (reason) { if (current === run.current && mounted.current) setError(reason instanceof Error ? reason.message : "The PDF failed validation."); }
        finally { if (event.data.bytes) new Uint8Array(event.data.bytes).fill(0); if (current === run.current && mounted.current) setBusy(false); }
      };
      active.onerror = () => { active.terminate(); worker.current = null; if (current === run.current && mounted.current) { setBusy(false); setError("Image conversion stopped unexpectedly."); } };
      active.postMessage({ files: payload, size, orientation }, payload.map(({ bytes }) => bytes));
    } catch { if (current === run.current && mounted.current) { setBusy(false); setError("Unable to read the selected images."); } }
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; run.current += 1; worker.current?.terminate(); if (urlRef.current) URL.revokeObjectURL(urlRef.current); }; }, []);
  return <section className="merge-panel" aria-labelledby="images-pdf-heading"><h2 id="images-pdf-heading">Combine images into a PDF on this device</h2><p>Choose JPG and PNG images; their listed order becomes the PDF page order.</p><div className="privacy-note">Up to {IMAGES_TO_PDF_LIMITS.files} files and 50 MB combined. Images are processed locally in a worker and the completed PDF is reopened and validated.</div><label className="file-picker">Choose JPG or PNG images<input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" multiple disabled={busy} onChange={(event) => { void choose(event.currentTarget.files); event.currentTarget.value = ""; }}/></label>{files.length > 0 && <><ol>{files.map((file, index) => <li key={`${file.name}-${index}`}>{file.name} · {(file.size / 1024).toFixed(1)} KB <button type="button" disabled={busy || index === 0} aria-label={`Move up ${file.name}`} onClick={() => move(index, -1)}>Move up</button> <button type="button" disabled={busy || index === files.length - 1} aria-label={`Move down ${file.name}`} onClick={() => move(index, 1)}>Move down</button></li>)}</ol><div className="split-settings"><label htmlFor="images-pdf-size">Page size</label><select id="images-pdf-size" className="split-range-input" value={size} disabled={busy} onChange={(event) => setSize(event.target.value as typeof size)}><option value="a4">A4</option><option value="letter">Letter</option><option value="image">Match image dimensions</option></select>{size !== "image" && <><label htmlFor="images-pdf-orientation">Orientation</label><select id="images-pdf-orientation" className="split-range-input" value={orientation} disabled={busy} onChange={(event) => setOrientation(event.target.value as typeof orientation)}><option value="auto">Match each image</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></>}</div></>}
    <div className="merge-actions"><button type="button" className="hero-cta" disabled={!files.length || busy} onClick={() => void process()}>{busy ? "Creating PDF…" : "Create PDF"}</button>{busy && <button type="button" onClick={cancel}>Cancel</button>}</div>{error && <p role="alert" className="merge-error">{error}</p>}{url && <p role="status" className="merge-success"><a href={url} download="images.pdf">Download validated PDF · {files.length} pages</a></p>}</section>;
}
