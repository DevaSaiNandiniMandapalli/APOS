"use client";

import { useEffect, useRef, useState } from "react";
import { checkPdfHeader, PDF_LIMITS } from "@/lib/pdf-limits";
import { unlockPdf } from "@/lib/pdf-security-tools";
import { safeFileStem } from "@/lib/pdf-images";

export default function UnlockPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const clear = () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; setUrl(null); };
  const choose = async (selected?: File) => {
    clear(); setError(""); setFile(null);
    if (!selected) return;
    if (!selected.size) { setError("The selected file is empty."); return; }
    if (selected.size > PDF_LIMITS.perFileBytes) { setError("The PDF exceeds the 50 MB input limit."); return; }
    const head = new Uint8Array(await selected.slice(0, 1024).arrayBuffer());
    if (!checkPdfHeader(head)) { setError("This file does not have a PDF signature."); return; }
    setFile(selected);
  };
  const run = async () => {
    if (!file) return;
    clear(); setError(""); setBusy(true); setProgress(null);
    try {
      const bytes = await unlockPdf(file, password, { onProgress: (done, total) => setProgress({ done, total }) });
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).slice().buffer as ArrayBuffer], { type: "application/pdf" }));
      urlRef.current = url; setUrl(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "This PDF could not be unlocked."); }
    finally { setBusy(false); setProgress(null); }
  };
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  return <section className="merge-panel" aria-labelledby="unlock-heading">
    <h2 id="unlock-heading">Remove a PDF password on this device</h2>
    <p>Open the file with the password you already know and APOS writes a new copy that no longer asks for it. The copy is rebuilt page by page as images, so the text layer is not preserved.</p>
    <div className="privacy-note">Only use this on documents you are allowed to open. The password and the file stay on this device.</div>
    <label className="file-picker">Choose a locked PDF<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => { void choose(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label>
    {file && <div className="split-settings">
      <p><strong>{file.name}</strong></p>
      <label htmlFor="unlock-password">PDF password</label>
      <input id="unlock-password" type="password" className="split-range-input" value={password} disabled={busy} autoComplete="off" onChange={(event) => setPassword(event.target.value)}/>
    </div>}
    <div className="merge-actions"><button type="button" className="hero-cta" disabled={!file || busy || !password} onClick={() => void run()}>{busy ? "Unlocking…" : "Unlock PDF"}</button></div>
    {busy && <p role="status" aria-live="polite">{progress ? `Rebuilding page ${progress.done} of ${progress.total}…` : "Opening the document…"}</p>}
    {error && <p role="alert" className="merge-error">{error}</p>}
    {url && <p role="status" className="merge-success"><a href={url} download={`${safeFileStem(file?.name ?? "document")}-unlocked.pdf`}>Download unlocked PDF</a></p>}
  </section>;
}
