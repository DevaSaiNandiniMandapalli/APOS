"use client";

import { useEffect, useRef, useState } from "react";
import { checkPdfHeader, PDF_LIMITS } from "@/lib/pdf-limits";
import { SIGNATURE_PLACEMENTS, signPdf, type SignaturePlacement } from "@/lib/pdf-security-tools";
import { safeFileStem } from "@/lib/pdf-images";

export default function SignPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [placement, setPlacement] = useState<SignaturePlacement>("bottom-right");
  const [fontSize, setFontSize] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const clear = () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; setUrl(null); };
  const choose = async (selected?: File) => {
    clear(); setError(""); setFile(null); if (!selected) return;
    if (!selected.size) { setError("The selected file is empty."); return; }
    if (selected.size > PDF_LIMITS.perFileBytes) { setError("The PDF exceeds the 50 MB input limit."); return; }
    try {
      const head = new Uint8Array(await selected.slice(0, 1024).arrayBuffer());
      if (!checkPdfHeader(head)) { setError("This file does not have a PDF signature."); return; }
      const pdf = await import("@cantoo/pdf-lib");
      const doc = await pdf.PDFDocument.load(new Uint8Array(await selected.arrayBuffer()), { ignoreEncryption: true });
      setPages(doc.getPageCount());
      setPage(1);
      setFile(selected);
    } catch { setError("This PDF could not be opened. It may be encrypted or damaged."); }
  };
  const sign = async () => {
    if (!file) return;
    clear(); setError(""); setBusy(true);
    try {
      const bytes = await signPdf(new Uint8Array(await file.arrayBuffer()), { text, page, placement, fontSize });
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).slice().buffer as ArrayBuffer], { type: "application/pdf" }));
      urlRef.current = url; setUrl(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The PDF could not be signed."); }
    finally { setBusy(false); }
  };
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  return <section className="merge-panel" aria-labelledby="sign-heading">
    <h2 id="sign-heading">Add a signature to a PDF on this device</h2>
    <p>Type the name to sign with and APOS draws it on the page with a signing line. This is a visual signature, not a cryptographic certificate.</p>
    <div className="privacy-note">The PDF never leaves this device. Limit: 50 MB and {PDF_LIMITS.pages} pages.</div>
    <label className="file-picker">Choose a PDF<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => { void choose(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label>
    {file && <div className="split-settings">
      <p><strong>{file.name}</strong></p>
      <label htmlFor="sign-text">Signature text</label>
      <input id="sign-text" className="split-range-input" maxLength={80} value={text} disabled={busy} placeholder="e.g. A. Sharma" onChange={(event) => setText(event.target.value)}/>
      <label htmlFor="sign-page">Page</label>
      <input id="sign-page" className="split-range-input" type="number" min={1} max={pages} value={page} disabled={busy} onChange={(event) => setPage(Math.min(pages, Math.max(1, Number(event.target.value) || 1)))}/>
      <label htmlFor="sign-placement">Position</label>
      <select id="sign-placement" className="split-range-input" value={placement} disabled={busy} onChange={(event) => setPlacement(event.target.value as SignaturePlacement)}>
        {SIGNATURE_PLACEMENTS.map((value) => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}
      </select>
      <label htmlFor="sign-size">Size ({fontSize} pt)</label>
      <input id="sign-size" type="range" min={12} max={60} step={1} value={fontSize} disabled={busy} onChange={(event) => setFontSize(Number(event.target.value))}/>
    </div>}
    <div className="merge-actions"><button type="button" className="hero-cta" disabled={!file || busy || !text.trim()} onClick={() => void sign()}>{busy ? "Signing…" : "Sign PDF"}</button></div>
    {error && <p role="alert" className="merge-error">{error}</p>}
    {url && <p role="status" className="merge-success"><a href={url} download={`${safeFileStem(file?.name ?? "document")}-signed.pdf`}>Download signed PDF</a></p>}
  </section>;
}
