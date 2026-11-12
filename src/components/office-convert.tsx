"use client";

import { useRef, useState } from "react";
import { MODE_COPY, convertOffice, type OfficeMode } from "@/lib/office-convert";

export default function OfficeConvert({ mode }: { mode: OfficeMode }) {
  const copy = MODE_COPY[mode];
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ url: string; name: string; detail: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  const clearResult = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setResult(null);
  };

  const pick = (selected: File | undefined) => {
    clearResult(); setError(""); setProgress("");
    if (!selected) { setFile(null); return; }
    if (!selected.size) { setFile(null); setError("That file is empty."); return; }
    if (selected.size > 50 * 1024 * 1024) { setFile(null); setError("Choose a file under 50 MB."); return; }
    setFile(selected);
  };

  const run = async () => {
    if (!file || busy) return;
    clearResult(); setError(""); setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const output = await convertOffice(mode, file, { signal: controller.signal, onProgress: setProgress });
      if (controller.signal.aborted) return;
      const blob = new Blob([output.bytes as unknown as BlobPart], { type: output.mime });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setResult({ url, name: output.fileName, detail: output.detail });
      setProgress("Done.");
    } catch (reason) {
      if (controller.signal.aborted) { setError("Conversion cancelled."); return; }
      setError(reason instanceof Error ? reason.message : "The conversion failed.");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setProgress("Cancelling…");
  };

  return (
    <section className="office" aria-labelledby="office-heading">
      <h2 id="office-heading">{copy.heading}</h2>
      <p>{copy.description}</p>
      <div className="privacy-note">
        Conversion runs entirely in this browser. Files are not uploaded, and nothing is stored after you leave the page.
      </div>

      <label className="file-picker">
        Choose a file
        <input
          type="file"
          accept={copy.accept}
          disabled={busy}
          onChange={(event) => { pick(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}
        />
      </label>

      <div className="office__actions">
        <button type="button" className="hero-cta" disabled={!file || busy} onClick={() => void run()}>
          {busy ? "Converting…" : copy.action}
        </button>
        {busy && <button type="button" onClick={cancel}>Cancel</button>}
        {file && <span className="office__file">{file.name}</span>}
      </div>

      {progress && <p role="status" aria-live="polite">{progress}</p>}
      {error && <p role="alert" className="merge-error">{error}</p>}

      {result && (
        <div role="status" className="merge-success">
          <p>{result.detail}</p>
          <a className="hero-cta" href={result.url} download={result.name}>Download {result.name}</a>
        </div>
      )}
    </section>
  );
}
