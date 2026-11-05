"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PDFDocument } from "@cantoo/pdf-lib";
import {
  INSPECTOR_LIMITS,
  buildReportRows,
  countText,
  describeType,
  formatBytes,
  isTextLike,
  reportToText,
  type FileFacts,
  type ReportRow,
} from "@/lib/file-inspector";

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export default function FileInspector() {
  const [file, setFile] = useState<File | null>(null);
  const [facts, setFacts] = useState<FileFacts | null>(null);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const runRef = useRef(0);
  const mountedRef = useRef(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runRef.current += 1;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, []);

  const inspect = useCallback(async (selected: File | undefined) => {
    if (!selected || busy) return;
    const run = ++runRef.current;
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    setError(""); setNotes([]); setCopied(false); setFacts(null); setRows([]);

    if (selected.size === 0) { setError("That file is empty, so there is nothing to inspect."); return; }
    if (selected.size > INSPECTOR_LIMITS.perFileBytes) {
      setError(`Choose a file under ${formatBytes(INSPECTOR_LIMITS.perFileBytes)}.`);
      return;
    }

    setFile(selected);
    setBusy(true);
    const extra: string[] = [];
    try {
      const buffer = await selected.arrayBuffer();
      if (run !== runRef.current) return;

      const base: FileFacts = {
        name: selected.name,
        size: selected.size,
        type: selected.type,
        lastModified: selected.lastModified,
      };

      try {
        base.checksum = await sha256(buffer);
      } catch {
        extra.push("This browser did not allow the SHA-256 checksum to be calculated.");
      }
      if (run !== runRef.current) return;

      const type = describeType(selected.type, selected.name);
      if (type === "PDF document") {
        try {
          const pdf = await PDFDocument.load(buffer, { updateMetadata: false, ignoreEncryption: false });
          base.pages = pdf.getPageCount();
          const page = pdf.getPageCount() ? pdf.getPage(0) : null;
          if (page) {
            const { width, height } = page.getSize();
            extra.push(`First page media box: ${Math.round(width)} × ${Math.round(height)} pt.`);
          }
          if (pdf.isEncrypted) extra.push("This PDF is encrypted; some properties may be limited.");
        } catch {
          extra.push("The PDF could not be parsed — it may be encrypted or damaged.");
        }
      } else if (type.includes("image") && !selected.type.includes("svg")) {
        try {
          const bitmap = await createImageBitmap(selected);
          base.width = bitmap.width;
          base.height = bitmap.height;
          bitmap.close?.();
        } catch {
          extra.push("Image dimensions could not be read by this browser.");
        }
      } else if (isTextLike(selected.type, selected.name)) {
        const preview = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 2 * 1024 * 1024));
        const { lines, words } = countText(preview);
        base.lines = lines;
        base.words = words;
        if (buffer.byteLength > preview.byteLength) extra.push("Text statistics cover the first 2 MB of this file.");
      }

      if (run !== runRef.current || !mountedRef.current) return;
      setFacts(base);
      setRows(buildReportRows(base));
      setNotes(extra);
    } catch {
      if (run === runRef.current) setError("This file could not be read. It may be locked or in use.");
    } finally {
      if (run === runRef.current) setBusy(false);
    }
  }, [busy]);

  const copyReport = async () => {
    if (!rows.length) return;
    try {
      await navigator.clipboard.writeText(reportToText(rows));
      setCopied(true);
      window.setTimeout(() => { if (mountedRef.current) setCopied(false); }, 2500);
    } catch {
      setError("Copying to the clipboard was blocked by the browser.");
    }
  };

  const reset = () => {
    runRef.current += 1;
    setFile(null); setFacts(null); setRows([]); setNotes([]); setError(""); setCopied(false); setBusy(false);
  };

  return (
    <section className="merge-panel" aria-labelledby="inspector-heading">
      <h2 id="inspector-heading">Inspect a file on this device</h2>
      <p>Read the basic properties of any document, image or text file. The file is opened locally and never uploaded.</p>
      <div className="privacy-note">
        Limit: {formatBytes(INSPECTOR_LIMITS.perFileBytes)} per file. The SHA-256 checksum is computed in this browser and can be used to confirm the file is unchanged.
      </div>
      <label className="file-picker">
        Choose a file to inspect
        <input
          type="file"
          disabled={busy}
          onChange={(event) => {
            void inspect(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </label>
      <div
        className="drop-zone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void inspect(event.dataTransfer.files?.[0]);
        }}
      >
        Or drop a file here
      </div>

      {busy && <p role="status" aria-live="polite">Reading {file?.name ?? "the file"} in this browser…</p>}
      {error && <p role="alert" className="merge-error">{error}</p>}

      {facts && rows.length > 0 && !busy && (
        <>
          <dl className="inspector__grid" aria-label="File properties">
            {rows.map((row) => (
              <div className="inspector__row" key={row.label}>
                <dt className="inspector__label">{row.label}</dt>
                <dd className="inspector__value" data-field={row.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}>{row.value}</dd>
              </div>
            ))}
          </dl>
          {notes.length > 0 && (
            <ul className="inspector__notes">
              {notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
          <div className="merge-actions">
            <button type="button" className="hero-cta" onClick={() => void copyReport()}>
              {copied ? "Copied" : "Copy details"}
            </button>
            <button type="button" onClick={reset}>Clear</button>
            <span>{describeType(facts.type, facts.name)} · {formatBytes(facts.size)}</span>
          </div>
        </>
      )}
    </section>
  );
}
