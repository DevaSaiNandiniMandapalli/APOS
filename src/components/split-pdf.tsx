"use client";

import { useEffect, useRef, useState } from "react";
import { PDF_LIMITS, checkPdfHeader } from "@/lib/pdf-limits";
import { parsePageRanges } from "@/lib/split-pdf";

type SplitReply = { ok: boolean; files?: ArrayBuffer[]; error?: string };
type SplitOutput = { url: string; name: string; pages: number };

export default function SplitPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [ranges, setRanges] = useState("1");
  const [outputs, setOutputs] = useState<SplitOutput[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const workerRef = useRef<Worker | null>(null);
  const taskRef = useRef(0);
  const mountedRef = useRef(false);
  const urlsRef = useRef<string[]>([]);

  const clearOutputs = () => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
    setOutputs([]);
  };

  const selectFile = async (selected: File | undefined) => {
    if (busy || !selected) return;
    clearOutputs(); setError(""); setFile(null);
    if (selected.size === 0) { setError("The selected file is empty."); return; }
    if (selected.size > PDF_LIMITS.perFileBytes) { setError("The PDF exceeds the 50 MB file limit."); return; }
    try {
      const head = new Uint8Array(await selected.slice(0, 1024).arrayBuffer());
      if (!checkPdfHeader(head)) { setError("This file does not have a PDF signature."); return; }
      setFile(selected); setRanges("1");
    } catch { setError("Unable to read the selected file."); }
  };

  const split = async () => {
    if (!file) { setError("Choose a PDF file first."); return; }
    let parsedRanges;
    try { parsedRanges = parsePageRanges(ranges, PDF_LIMITS.pages); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Enter valid page ranges."); return; }
    if (parsedRanges.length > PDF_LIMITS.splitOutputs) { setError(`Create no more than ${PDF_LIMITS.splitOutputs} output files at once.`); return; }
    clearOutputs(); setError(""); setBusy(true);
    const task = ++taskRef.current;
    try {
      const buffer = await file.arrayBuffer();
      if (task !== taskRef.current) { new Uint8Array(buffer).fill(0); return; }
      const worker = new Worker(new URL("@/workers/split-pdf.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = async (event: MessageEvent<SplitReply>) => {
        worker.terminate(); workerRef.current = null;
        if (!mountedRef.current || task !== taskRef.current) {
          event.data.files?.forEach((bytes) => new Uint8Array(bytes).fill(0));
          return;
        }
        setBusy(false);
        if (!event.data.ok || !event.data.files) { setError(event.data.error ?? "The split failed."); return; }
        const ready: SplitOutput[] = [];
        try {
          for (let index = 0; index < event.data.files.length; index += 1) {
            const bytes = event.data.files[index];
            const expected = parsedRanges[index].last - parsedRanges[index].first + 1;
            const blob = new Blob([bytes], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);
            urlsRef.current.push(url);
            const stem = file.name.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 100) || "document";
            ready.push({ url, name: `${stem}-pages-${parsedRanges[index].first}-${parsedRanges[index].last}.pdf`, pages: expected });
            new Uint8Array(bytes).fill(0);
          }
          if (!mountedRef.current || task !== taskRef.current) { clearOutputs(); return; }
          setOutputs(ready);
        } catch { clearOutputs(); if (mountedRef.current && task === taskRef.current) setError("A generated PDF failed validation and was discarded."); }
        finally { event.data.files.forEach((bytes) => new Uint8Array(bytes).fill(0)); }
      };
      worker.onerror = () => {
        worker.terminate(); workerRef.current = null;
        if (mountedRef.current && task === taskRef.current) { setBusy(false); setError("PDF processing stopped unexpectedly. Try a different file."); }
      };
      worker.postMessage({ file: buffer, ranges: parsedRanges }, [buffer]);
    } catch {
      if (mountedRef.current && task === taskRef.current) { setBusy(false); setError("Unable to read the selected file."); }
    }
  };

  const cancel = () => {
    taskRef.current += 1; workerRef.current?.terminate(); workerRef.current = null;
    setBusy(false); setError("Split cancelled. Temporary in-memory data was released.");
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; taskRef.current += 1; workerRef.current?.terminate(); urlsRef.current.forEach((url) => URL.revokeObjectURL(url)); urlsRef.current = []; };
  }, []);

  return <section className="merge-panel" aria-labelledby="split-heading">
    <h2 id="split-heading">Split PDF on this device</h2>
    <p>Select page ranges to create separate PDF files. Your document stays in this browser.</p>
    <div className="privacy-note">Limit: one PDF up to {PDF_LIMITS.perFileBytes / 1024 / 1024} MB and {PDF_LIMITS.pages} pages, up to {PDF_LIMITS.splitOutputs} outputs and {PDF_LIMITS.splitTotalBytes / 1024 / 1024} MB combined. Each range becomes its own validated PDF.</div>
    <label className="file-picker">Choose a PDF<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => { void selectFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
    {file && <div className="split-settings"><p><strong>{file.name}</strong> · PDF structure is checked during processing</p><label htmlFor="split-ranges">Page ranges</label><input id="split-ranges" className="split-range-input" value={ranges} disabled={busy} onChange={(event) => setRanges(event.target.value)} aria-describedby="split-range-help"/><p id="split-range-help" className="route-note">Use comma-separated pages or ranges, for example 1-3, 5. Overlapping ranges are rejected.</p></div>}
    <div className="merge-actions"><button type="button" className="hero-cta" disabled={busy || !file} onClick={() => void split()}>{busy ? "Splitting…" : "Split PDF"}</button>{busy && <button type="button" onClick={cancel}>Cancel</button>}</div>
    {busy && <p role="status" aria-live="polite">Processing in a dedicated browser worker. Progress is indeterminate.</p>}
    {error && <p role="alert" className="merge-error">{error}</p>}
    {outputs.length > 0 && <div role="status" className="merge-success"><p>Validated {outputs.length} PDF file(s) · {outputs.reduce((sum, output) => sum + output.pages, 0)} pages</p><ul>{outputs.map((output) => <li key={output.url}><a href={output.url} download={output.name}>{output.name} · {output.pages} page(s)</a></li>)}</ul></div>}
  </section>;
}
