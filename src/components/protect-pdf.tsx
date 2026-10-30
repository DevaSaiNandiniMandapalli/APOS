"use client";

import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS } from "@/lib/pdf-limits";
import { safeFileStem } from "@/lib/pdf-images";

type Reply = { ok: boolean; output?: ArrayBuffer; error?: string };
export default function ProtectPdf() {
  const [file, setFile] = useState<File | null>(null); const [userPassword, setUserPassword] = useState(""); const [ownerPassword, setOwnerPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [url, setUrl] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null); const urlRef = useRef<string | null>(null); const run = useRef(0); const mounted = useRef(false);
  const revoke = () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; setUrl(null); };
  const choose = async (selected?: File) => { if (busy) return; revoke(); setFile(null); setError(""); if (!selected) return; if (!selected.size || selected.size > PDF_LIMITS.perFileBytes) { setError("Choose a non-empty PDF under 50 MB."); return; } try { if (!checkPdfHeader(new Uint8Array(await selected.slice(0, 1024).arrayBuffer()))) { setError("This file does not have a PDF signature."); return; } setFile(selected); } catch { setError("Unable to read the selected PDF."); } };
  const cancel = () => { run.current += 1; worker.current?.terminate(); worker.current = null; setBusy(false); setUserPassword(""); setOwnerPassword(""); setError("Processing cancelled. Temporary browser data was released."); };
  const protect = async () => {
    if (!file || busy) return; revoke(); setError(""); setBusy(true); const current = ++run.current;
    let bytes: ArrayBuffer | null = null;
    try {
      bytes = await file.arrayBuffer(); if (current !== run.current) { if (bytes.byteLength) new Uint8Array(bytes).fill(0); return; }
      const active = new Worker(new URL("@/workers/pdf-security.worker.ts", import.meta.url), { type: "module" }); worker.current = active;
      const password = userPassword; const owner = ownerPassword;
      active.onmessage = async (event: MessageEvent<Reply>) => {
        active.terminate(); worker.current = null;
        if (current !== run.current || !mounted.current) { if (event.data.output?.byteLength) new Uint8Array(event.data.output).fill(0); return; }
        try {
          if (!event.data.ok || !event.data.output) throw new Error(event.data.error ?? "The PDF could not be protected.");
          if (!checkPdfHeader(new Uint8Array(event.data.output))) throw new Error("The protected PDF failed its signature check.");
          let opened: PDFDocument | null = null;
          try { opened = await PDFDocument.load(event.data.output, { password }); } catch { throw new Error("The output did not accept the supplied opening password."); }
          if (opened.getPageCount() < 1 || opened.getPageCount() > PDF_LIMITS.pages) throw new Error("The protected PDF failed its page-count check.");
          let requiresPassword = false; try { await PDFDocument.load(event.data.output); } catch { requiresPassword = true; }
          if (!requiresPassword) throw new Error("The generated PDF did not require a password.");
          if (current !== run.current || !mounted.current) return;
          const objectUrl = URL.createObjectURL(new Blob([event.data.output], { type: "application/pdf" })); urlRef.current = objectUrl; setUrl(objectUrl);
        } catch (reason) { if (current === run.current && mounted.current) setError(reason instanceof Error ? reason.message : "The protected PDF failed validation."); }
        finally { if (event.data.output?.byteLength) new Uint8Array(event.data.output).fill(0); if (current === run.current && mounted.current) { setBusy(false); setUserPassword(""); setOwnerPassword(""); } }
      };
      active.onerror = () => { active.terminate(); worker.current = null; if (current === run.current && mounted.current) { setBusy(false); setUserPassword(""); setOwnerPassword(""); setError("PDF protection stopped unexpectedly."); } };
      active.postMessage({ bytes, userPassword: password, ownerPassword: owner }, [bytes]); bytes = null; setUserPassword(""); setOwnerPassword("");
    } catch { if (current === run.current && mounted.current) { setBusy(false); setUserPassword(""); setOwnerPassword(""); setError("Unable to read the selected PDF."); } }
    finally { if (bytes?.byteLength) new Uint8Array(bytes).fill(0); }
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; run.current += 1; worker.current?.terminate(); if (urlRef.current) URL.revokeObjectURL(urlRef.current); }; }, []);
  return <section className="merge-panel" aria-labelledby="protect-pdf-heading"><h2 id="protect-pdf-heading">Protect a PDF with an opening password</h2><p>Applies AES-256 PDF encryption. The opening password and separate owner password are required. PDF reader permission enforcement varies and does not prevent screenshots or copying after opening.</p><div className="privacy-note">Passwords and document data are handled in a local worker and are not stored or sent to APOS.</div><label className="file-picker">Choose a PDF<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => { void choose(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label>{file && <p><strong>{file.name}</strong> · {(file.size / 1024).toFixed(1)} KB</p>}<div className="split-settings"><label htmlFor="pdf-user-password">Opening password (12 characters minimum)</label><input id="pdf-user-password" type="password" autoComplete="new-password" minLength={12} maxLength={256} value={userPassword} disabled={busy} onChange={(event) => setUserPassword(event.target.value)}/><label htmlFor="pdf-owner-password">Owner password (12 characters minimum, different from opening password)</label><input id="pdf-owner-password" type="password" autoComplete="new-password" minLength={12} maxLength={256} value={ownerPassword} disabled={busy} onChange={(event) => setOwnerPassword(event.target.value)}/></div><div className="merge-actions"><button type="button" className="hero-cta" disabled={!file || busy || userPassword.length < 12 || ownerPassword.length < 12 || userPassword === ownerPassword} onClick={() => void protect()}>{busy ? "Protecting PDF…" : "Protect PDF"}</button>{busy && <button type="button" onClick={cancel}>Cancel</button>}</div>{error && <p role="alert" className="merge-error">{error}</p>}{url && <p role="status" className="merge-success"><a href={url} download={`${safeFileStem(file?.name ?? "document")}-protected.pdf`}>Download password-protected PDF</a></p>}</section>;
}
