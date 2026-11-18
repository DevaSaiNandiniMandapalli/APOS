"use client";

import { useEffect, useRef, useState } from "react";
import { MODE_COPY, convertOffice, type OfficeMode } from "@/lib/office-convert";
import { fetchServerRegistry, runServerOfficeToPdf } from "@/lib/server-tools";

const SERVER_EXTENSIONS = [".doc", ".docx", ".odt", ".rtf", ".xls", ".xlsx", ".ods", ".ppt", ".pptx", ".odp"];

function serverCanHandle(name: string) {
  const lower = name.toLowerCase();
  return SERVER_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export default function OfficeConvert({ mode }: { mode: OfficeMode }) {
  const copy = MODE_COPY[mode];
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ url: string; name: string; detail: string } | null>(null);
  const [engine, setEngine] = useState<"browser" | "server">("browser");
  const [serverAvailable, setServerAvailable] = useState(false);
  const [serverChecked, setServerChecked] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (mode !== "document-to-pdf") return;
    const controller = new AbortController();
    void fetchServerRegistry(controller.signal)
      .then((registry) => {
        const tool = registry.tools.find((candidate) => candidate.name === "office_to_pdf");
        const available = Boolean(tool?.available);
        setServerAvailable(available);
        // The layout-preserving engine reproduces the document exactly, so it is
        // the default whenever the processing server offers it.
        if (available) setEngine("server");
        setServerChecked(true);
      })
      .catch(() => {
        setServerAvailable(false);
        setServerChecked(true);
      });
    return () => controller.abort();
  }, [mode]);

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
      if (mode === "document-to-pdf" && engine === "server") {
        if (!serverCanHandle(file.name)) {
          throw new Error("The layout-preserving engine handles Word, Excel, PowerPoint, OpenDocument and RTF files. Use the browser engine for text, Markdown, CSV or JSON.");
        }
        setProgress("Uploading to your APOS processing server…");
        const output = await runServerOfficeToPdf(file, controller.signal);
        if (controller.signal.aborted) return;
        const blob = new Blob([new Uint8Array(await output.blob.arrayBuffer()) as unknown as BlobPart], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setResult({
          url,
          name: output.filename,
          detail: "Layout-preserving PDF generated on your APOS processing server with LibreOffice. Fonts, colours, tables, pictures and page breaks are kept.",
        });
        setProgress("Done.");
        return;
      }
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

  const showEngine = mode === "document-to-pdf";

  return (
    <section className="office" aria-labelledby="office-heading">
      <h2 id="office-heading">{copy.heading}</h2>
      <p>{copy.description}</p>
      <div className="privacy-note">
        {showEngine && engine === "server"
          ? "Layout-preserving mode uploads this document to the configured APOS processing server. That server handles the file in memory or a temporary directory, uses no database, and does not keep it permanently. Browser mode remains available and never uploads."
          : "Conversion runs entirely in this browser. Files are not uploaded, and nothing is stored after you leave the page."}
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

      {showEngine && (
        <div className="office-options">
          <fieldset className="conversion-options">
            <legend>Engine</legend>
            <label>PDF engine
              <select aria-label="PDF engine" value={engine} disabled={busy} onChange={(event) => setEngine(event.target.value as "browser" | "server")}>
                <option value="browser">Browser — text-faithful, never uploads</option>
                {serverAvailable && <option value="server">Layout-preserving server — keeps fonts, colours and layout</option>}
              </select>
            </label>
            {!serverChecked && <span className="route-note">Checking the optional processing server…</span>}
            {serverChecked && !serverAvailable && (
              <span className="route-note">
                The layout-preserving engine is not configured. Browser mode reflows the text and does not reproduce the original layout.
              </span>
            )}
            {serverAvailable && engine === "browser" && (
              <span className="route-note">
                Browser mode rebuilds the text. For a page-for-page match of the original document, choose the layout-preserving server engine.
              </span>
            )}
          </fieldset>
        </div>
      )}

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
