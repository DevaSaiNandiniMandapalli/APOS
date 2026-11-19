"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  buildDocumentPassport,
  createCleanPdf,
  PASSPORT_LIMITS,
  type PassportFlag,
  type PassportReport,
  type PassportSeverity,
} from "@/lib/document-passport";

const ACCEPT = ".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.tif,.tiff";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function severityLabel(severity: PassportSeverity) {
  return severity === "high" ? "High" : severity === "medium" ? "Medium" : severity === "low" ? "Low" : "Note";
}

function verdictLabel(report: PassportReport) {
  if (report.verdict === "clean") return "Looks clean";
  if (report.verdict === "review") return "Review before sharing";
  return "Sensitive signals";
}

function FlagRow({ flag }: { flag: PassportFlag }) {
  return (
    <li className={`passport-flag passport-flag--${flag.severity}`}>
      <span className="passport-flag-severity">{severityLabel(flag.severity)}</span>
      <div>
        <strong>{flag.label}</strong>
        <p>{flag.detail}</p>
        {flag.tool ? <Link href={flag.tool.href} className="text-link">{flag.tool.label}</Link> : null}
      </div>
    </li>
  );
}

export default function DocumentPassport() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<PassportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanStage, setScanStage] = useState("");
  const [error, setError] = useState("");
  const [cleanBusy, setCleanBusy] = useState(false);
  const [cleanUrl, setCleanUrl] = useState("");
  const [cleanNote, setCleanNote] = useState("");
  const [cleanError, setCleanError] = useState("");
  const [reportUrl, setReportUrl] = useState("");
  const runRef = useRef(0);
  const mountedRef = useRef(false);
  const cleanUrlRef = useRef("");
  const reportUrlRef = useRef("");

  const revokeAuxiliary = () => {
    if (cleanUrlRef.current) URL.revokeObjectURL(cleanUrlRef.current);
    if (reportUrlRef.current) URL.revokeObjectURL(reportUrlRef.current);
    cleanUrlRef.current = "";
    reportUrlRef.current = "";
    setCleanUrl("");
    setReportUrl("");
  };

  const reset = () => {
    runRef.current += 1;
    revokeAuxiliary();
    setFile(null);
    setReport(null);
    setError("");
    setScanStage("");
    setCleanBusy(false);
    setCleanNote("");
    setCleanError("");
  };

  const scan = async (selected: File) => {
    const run = ++runRef.current;
    revokeAuxiliary();
    setFile(selected);
    setReport(null);
    setError("");
    setCleanNote("");
    setCleanError("");
    setBusy(true);
    setScanStage("Fingerprinting the file…");
    try {
      const next = await buildDocumentPassport(selected, { deep: true });
      if (!mountedRef.current || run !== runRef.current) return;
      setReport(next);
      setScanStage("");
    } catch (reason) {
      if (mountedRef.current && run === runRef.current) {
        setError(reason instanceof Error ? reason.message : "This file could not be inspected.");
        setScanStage("");
      }
    } finally {
      if (mountedRef.current && run === runRef.current) setBusy(false);
    }
  };

  const downloadReport = () => {
    if (!report) return;
    if (reportUrlRef.current) URL.revokeObjectURL(reportUrlRef.current);
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    reportUrlRef.current = url;
    setReportUrl(url);
  };

  const makeCleanCopy = async () => {
    if (!file || !report?.canSanitize || cleanBusy) return;
    setCleanBusy(true);
    setCleanError("");
    setCleanNote("");
    revokeAuxiliary();
    try {
      const result = await createCleanPdf(file);
      if (!mountedRef.current) return;
      const blob = new Blob([result.bytes.slice() as unknown as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      cleanUrlRef.current = url;
      setCleanUrl(url);
      setCleanNote(`Clean copy created: ${result.pageCount} page(s). Removed ${result.removed.join(", ")}.`);
    } catch (reason) {
      if (mountedRef.current) setCleanError(reason instanceof Error ? reason.message : "The clean copy could not be created.");
    } finally {
      if (mountedRef.current) setCleanBusy(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runRef.current += 1;
      revokeAuxiliary();
    };
  }, []);

  const outputStem = (file?.name ?? "document").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-") || "document";

  return (
    <section className="passport" aria-labelledby="passport-heading">
      <h2 id="passport-heading">Document Passport</h2>
      <p>
        Fingerprint a PDF, Word, Excel, PowerPoint or image file, map the hidden data that travels with it, and get a
        plain-language share-readiness score. Everything is read locally. The scan is a review aid, not a guarantee that
        a document contains no sensitive content.
      </p>
      <div className="privacy-note">
        Limit: {formatBytes(PASSPORT_LIMITS.perFileBytes)} per file. PDF text inspection samples up to {PASSPORT_LIMITS.sampledPages} pages.
        The file is never uploaded. The report stays in this tab.
      </div>

      <label className="file-picker">
        Choose a document
        <input
          type="file"
          accept={ACCEPT}
          disabled={busy || cleanBusy}
          onChange={(event) => {
            const selected = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (selected) void scan(selected);
          }}
        />
      </label>

      {file ? (
        <div className="passport-file">
          <Fingerprint size={18} aria-hidden="true" />
          <span><strong>{file.name}</strong> · {formatBytes(file.size)}</span>
          {report ? <span className={`passport-verdict passport-verdict--${report.verdict}`}>{verdictLabel(report)}</span> : null}
        </div>
      ) : null}

      {busy ? <p role="status" aria-live="polite" className="passport-status"><Loader2 size={16} className="is-spinning" aria-hidden="true" /> {scanStage || "Inspecting the document…"}</p> : null}
      {error ? <p role="alert" className="merge-error">{error}</p> : null}

      {report ? (
        <div className="passport-report">
          <div className={`passport-hero passport-hero--${report.verdict}`}>
            <div className="passport-score">
              <strong>{report.score}</strong>
              <span>/ 100</span>
            </div>
            <div>
              <div className="section-eyebrow">SHARE-READINESS SCORE</div>
              <h3>{verdictLabel(report)}</h3>
              <p>
                {report.score >= 85
                  ? "No high-risk markers were found. Review the flags below before sending this file outside your organisation."
                  : report.score >= 60
                    ? "Some markers deserve a look before this file is shared. Review the flagged items and use the linked tools where appropriate."
                    : "Several sensitive or active-content markers were found. Treat this file as sensitive and review every flag before sharing."}
              </p>
            </div>
          </div>

          <div className="passport-actions">
            <button type="button" className="hero-cta" onClick={downloadReport}>Download JSON report</button>
            {reportUrl ? <a className="text-link" href={reportUrl} download={`${outputStem}-passport.json`}>Save report</a> : null}
            <button type="button" onClick={reset} disabled={busy || cleanBusy}>Scan another file</button>
          </div>

          {report.flags.length ? (
            <section className="passport-section" aria-labelledby="passport-flags">
              <h3 id="passport-flags">Flags to review</h3>
              <ul className="passport-flags">
                {report.flags.map((flag) => <FlagRow key={flag.id} flag={flag} />)}
              </ul>
            </section>
          ) : (
            <section className="passport-section">
              <h3>No risk flags found</h3>
              <p className="route-note">The scanner found no metadata, active content, attachments or hidden-object markers in the parts it could inspect.</p>
            </section>
          )}

          {report.sections.map((section) => (
            <section className="passport-section" key={section.title}>
              <h3>{section.title}</h3>
              <dl className="passport-fields">
                {section.fields.map((field) => (
                  <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>
                ))}
              </dl>
            </section>
          ))}

          {report.notes.length ? (
            <section className="passport-section" aria-labelledby="passport-notes">
              <h3 id="passport-notes">Notes and limits</h3>
              <ul className="passport-notes">{report.notes.map((note) => <li key={note}>{note}</li>)}</ul>
            </section>
          ) : null}

          <section className="passport-section passport-clean" aria-labelledby="passport-clean">
            <h3 id="passport-clean"><ShieldCheck size={17} aria-hidden="true" /> Clean PDF copy</h3>
            <p>{report.sanitizeNote}</p>
            {report.canSanitize ? (
              <div className="merge-actions">
                <button type="button" className="hero-cta" disabled={cleanBusy} onClick={() => void makeCleanCopy()}>
                  {cleanBusy ? "Building clean copy…" : "Create clean PDF copy"}
                </button>
                {cleanUrl ? <a className="text-link" href={cleanUrl} download={`${outputStem}-clean.pdf`}>Download clean PDF</a> : null}
              </div>
            ) : null}
            {cleanNote ? <p role="status" className="merge-success">{cleanNote}</p> : null}
            {cleanError ? <p role="alert" className="merge-error">{cleanError}</p> : null}
          </section>

          <div className="passport-footer">
            <Sparkles size={16} aria-hidden="true" />
            <span>Use the flags as a starting point, then verify the cleaned file with a fresh scan or the Compare workflow.</span>
          </div>
        </div>
      ) : null}

      <div className="passport-legend">
        <span><CheckCircle2 size={14} aria-hidden="true" /> 85–100: low-risk markers</span>
        <span><AlertTriangle size={14} aria-hidden="true" /> 60–84: review recommended</span>
        <span><AlertTriangle size={14} aria-hidden="true" /> 0–59: sensitive signals</span>
      </div>
    </section>
  );
}
