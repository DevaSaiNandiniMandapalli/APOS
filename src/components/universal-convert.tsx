"use client";

import { useRef, useState } from "react";
import { canonicalTarget, convertUniversal, planConversion, TARGET_LABELS, type Target } from "@/lib/universal-convert";

const TARGETS = Object.keys(TARGET_LABELS) as Target[];
const EXAMPLES = ["Convert to PDF", "Make it a Word file", "Change to JPG", "Turn into Excel", "Extract the text"];

export default function UniversalConvert() {
  const [file, setFile] = useState<File | null>(null);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ url: string; name: string; detail: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  const clearResult = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setResult(null);
  };

  const target = canonicalTarget(request);
  const preview = file && target ? planConversion(guessKind(file.name), target) : null;

  const changeFile = (selected: File | undefined) => {
    clearResult(); setError(""); setStatus("");
    setFile(selected ?? null);
  };

  const run = async () => {
    if (!file || !target || busy) {
      if (!target) setError("Tell me the format you want — for example \"convert to PDF\".");
      return;
    }
    clearResult(); setError(""); setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const output = await convertUniversal(file, target, { signal: controller.signal, onProgress: setStatus });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([output.bytes as unknown as BlobPart], { type: output.mime }));
      urlRef.current = url;
      setResult({ url, name: output.fileName, detail: output.detail });
      setStatus("Done.");
    } catch (reason) {
      if (controller.signal.aborted) { setError("Conversion cancelled."); return; }
      setError(reason instanceof Error ? reason.message : "The conversion failed.");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <section className="univ" aria-labelledby="univ-heading">
      <h2 id="univ-heading">Convert anything</h2>
      <p>
        Drop any file and say what you want. APOS works out the right converter, or tells you plainly when a path is not supported.
      </p>
      <div className="privacy-note">
        Every conversion runs in this browser. Files are never uploaded, and nothing is kept after you leave the page.
      </div>

      <label className="file-picker">
        Your file
        <input
          type="file"
          disabled={busy}
          onChange={(event) => { changeFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}
        />
      </label>

      <label className="univ__label" htmlFor="univ-target">What do you want?</label>
      <input
        id="univ-target"
        className="univ__input"
        list="univ-targets"
        value={request}
        disabled={busy}
        placeholder="e.g. convert to PDF"
        onChange={(event) => { setRequest(event.currentTarget.value); clearResult(); setError(""); }}
      />
      <datalist id="univ-targets">
        {TARGETS.map((item) => <option key={item} value={`Convert to ${TARGET_LABELS[item]}`} />)}
      </datalist>

      <div className="univ__examples">
        {EXAMPLES.map((example) => (
          <button key={example} type="button" disabled={busy} onClick={() => { setRequest(example); clearResult(); setError(""); }}>
            {example}
          </button>
        ))}
      </div>

      {preview && !preview.supported && <p className="univ__plan">{preview.reason}</p>}
      {preview && preview.supported && <p className="univ__plan">Route: {preview.description}</p>}

      <div className="univ__actions">
        <button type="button" className="hero-cta" disabled={!file || !target || busy || (preview !== null && !preview.supported)} onClick={() => void run()}>
          {busy ? "Converting…" : "Convert"}
        </button>
        {busy && <button type="button" onClick={() => abortRef.current?.abort()}>Cancel</button>}
        {file && <span className="univ__file">{file.name}</span>}
      </div>

      {status && <p role="status" aria-live="polite">{status}</p>}
      {error && <p role="alert" className="merge-error">{error}</p>}

      {result && (
        <div className="merge-success">
          <p>{result.detail}</p>
          <a className="hero-cta" href={result.url} download={result.name}>Download {result.name}</a>
        </div>
      )}
    </section>
  );
}

function guessKind(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf" as const;
  if (lower.endsWith(".docx")) return "docx" as const;
  if (lower.endsWith(".xlsx")) return "xlsx" as const;
  if (lower.endsWith(".pptx")) return "pptx" as const;
  if (lower.endsWith(".png")) return "png" as const;
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpeg" as const;
  if (lower.endsWith(".webp")) return "webp" as const;
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "tiff" as const;
  if (lower.endsWith(".csv")) return "csv" as const;
  if (lower.endsWith(".json")) return "json" as const;
  return "text" as const;
}
