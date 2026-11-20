"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  GitCompareArrows,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import {
  comparePdfPair,
  renderVerifyPreview,
  VERIFY_LIMITS,
  type VerifyPageResult,
  type VerifyPreview,
  type VerifyReport,
} from "@/lib/pdf-verify";

function formatPercent(value: number) {
  if (value >= 99.995) return "100%";
  return `${value.toFixed(value >= 99.95 ? 2 : 1)}%`;
}

function verdictLabel(verdict: VerifyReport["verdict"]) {
  if (verdict === "identical") return "Identical";
  if (verdict === "minor-differences") return "Minor differences";
  if (verdict === "changed") return "Changed";
  return "Major differences";
}

function statusLabel(status: VerifyPageResult["status"]) {
  if (status === "identical") return "Identical";
  if (status === "text-changed") return "Text changed";
  if (status === "visual-change") return "Visual change";
  if (status === "size-changed") return "Page size changed";
  if (status === "missing-before") return "Only in result";
  return "Only in original";
}

function statusClass(status: VerifyPageResult["status"]) {
  if (status === "identical") return "is-ok";
  if (status === "text-changed" || status === "size-changed") return "is-review";
  return "is-different";
}

export default function VerifyCompare() {
  const [before, setBefore] = useState<File | null>(null);
  const [after, setAfter] = useState<File | null>(null);
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<VerifyPreview | null>(null);
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [reportUrl, setReportUrl] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const reportUrlRef = useRef("");
  const previewRunRef = useRef(0);

  const revokeReport = () => {
    if (reportUrlRef.current) URL.revokeObjectURL(reportUrlRef.current);
    reportUrlRef.current = "";
    setReportUrl("");
  };

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    previewRunRef.current += 1;
    revokeReport();
    setBefore(null);
    setAfter(null);
    setReport(null);
    setPreview(null);
    setPreviewPage(null);
    setPreviewBusy(false);
    setError("");
    setProgress("");
    setBusy(false);
  };

  const choose = (which: "before" | "after", file: File | undefined) => {
    if (!file) return;
    previewRunRef.current += 1;
    revokeReport();
    setReport(null);
    setPreview(null);
    setPreviewPage(null);
    setPreviewBusy(false);
    setError("");
    setProgress("");
    if (!file.size) { setError("That PDF is empty."); return; }
    if (file.size > VERIFY_LIMITS.perFileBytes) { setError(`Choose a PDF under ${VERIFY_LIMITS.perFileBytes / 1024 / 1024} MB.`); return; }
    if (which === "before") setBefore(file); else setAfter(file);
  };

  const compare = async () => {
    if (!before || !after || busy) return;
    previewRunRef.current += 1;
    revokeReport();
    setReport(null);
    setPreview(null);
    setPreviewPage(null);
    setPreviewBusy(false);
    setError("");
    setBusy(true);
    setProgress("Opening both PDFs…");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const next = await comparePdfPair(before, after, {
        signal: controller.signal,
        onProgress: (page, total) => setProgress(`Comparing page ${page} of ${total}…`),
      });
      if (!mountedRef.current || controller.signal.aborted) return;
      setReport(next);
      setProgress("");
    } catch (reason) {
      if (controller.signal.aborted) {
        if (mountedRef.current) { setError("Comparison cancelled."); setProgress(""); }
        return;
      }
      if (mountedRef.current) {
        setError(reason instanceof Error ? reason.message : "The PDFs could not be compared.");
        setProgress("");
      }
    } finally {
      if (mountedRef.current) setBusy(false);
      abortRef.current = null;
    }
  };

  const openPreview = async (page: number) => {
    if (!before || !after || previewBusy) return;
    const run = ++previewRunRef.current;
    setPreviewBusy(true);
    setError("");
    setPreviewPage(page);
    try {
      const next = await renderVerifyPreview(before, after, page);
      if (mountedRef.current && run === previewRunRef.current) setPreview(next);
    } catch (reason) {
      if (mountedRef.current && run === previewRunRef.current) setError(reason instanceof Error ? reason.message : "The page preview could not be rendered.");
    } finally {
      if (mountedRef.current && run === previewRunRef.current) setPreviewBusy(false);
    }
  };

  const downloadReport = () => {
    if (!report) return;
    revokeReport();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    reportUrlRef.current = url;
    setReportUrl(url);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `verify-${report.beforeName.replace(/\.pdf$/i, "")}-vs-${report.afterName.replace(/\.pdf$/i, "")}.json`;
    anchor.click();
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (reportUrlRef.current) URL.revokeObjectURL(reportUrlRef.current);
    };
  }, []);

  return (
    <section className="verify" aria-labelledby="verify-heading">
      <h2 id="verify-heading">Verify and compare PDFs on this device</h2>
      <p>
        Compare an original PDF with a compressed, repaired, redacted, converted or re-saved copy. APOS reports page
        count, text similarity and visual difference for every page, so you can see whether an operation changed
        something you did not intend to change.
      </p>
      <div className="privacy-note">
        Both PDFs are read and compared in this browser; nothing is uploaded. Limit: {VERIFY_LIMITS.perFileBytes / 1024 / 1024} MB per file,
        up to {VERIFY_LIMITS.maxPages} pages per comparison. Rendering is sampled at {VERIFY_LIMITS.renderScale}× for speed.
      </div>

      <div className="verify-files">
        <label className="file-picker">
          Original PDF
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(event) => { choose("before", event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}
          />
        </label>
        <label className="file-picker">
          Result PDF
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(event) => { choose("after", event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}
          />
        </label>
      </div>

      {before || after ? (
        <div className="verify-selection">
          <span><strong>Original:</strong> {before?.name ?? "not selected"}</span>
          <span><strong>Result:</strong> {after?.name ?? "not selected"}</span>
        </div>
      ) : null}

      <div className="merge-actions">
        <button type="button" className="hero-cta" disabled={!before || !after || busy} onClick={() => void compare()}>
          {busy ? "Comparing…" : "Compare PDFs"}
        </button>
        {busy ? <button type="button" onClick={() => abortRef.current?.abort()}>Cancel</button> : null}
        <button type="button" onClick={reset} disabled={busy || previewBusy}>Clear</button>
      </div>

      {progress ? <p role="status" aria-live="polite" className="verify-status"><Loader2 size={15} className="is-spinning" aria-hidden="true" /> {progress}</p> : null}
      {error ? <p role="alert" className="merge-error">{error}</p> : null}

      {report ? (
        <div className="verify-report">
          <div className={`verify-hero verify-hero--${report.verdict}`}>
            <div className="verify-score">
              <strong>{formatPercent(report.averageVisualSimilarityPercent)}</strong>
              <span>visual match</span>
            </div>
            <div>
              <div className="section-eyebrow"><GitCompareArrows size={12} aria-hidden="true" /> COMPARISON RESULT</div>
              <h3>{verdictLabel(report.verdict)}</h3>
              <p>
                {report.verdict === "identical"
                  ? "The page counts, text and rendered pixels match at the comparison resolution."
                  : report.verdict === "minor-differences"
                    ? "The documents are close. Review the page-level flags before treating the result as equivalent."
                    : "The documents differ materially. Review every flagged page and the text changes before using the result."}
              </p>
            </div>
          </div>

          <div className="verify-stats">
            <div><span>Pages</span><strong>{report.beforePages} → {report.afterPages}</strong></div>
            <div><span>Text match</span><strong>{formatPercent(report.averageTextSimilarityPercent)}</strong></div>
            <div><span>Identical pages</span><strong>{report.identicalPages}</strong></div>
            <div><span>Text changes</span><strong>{report.textChangedPages}</strong></div>
            <div><span>Visual changes</span><strong>{report.visualChangedPages}</strong></div>
            <div><span>Missing pages</span><strong>{report.missingPages}</strong></div>
          </div>

          {report.warnings.length ? (
            <div className="verify-warnings" role="status">
              <AlertTriangle size={17} aria-hidden="true" />
              <ul>{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>
          ) : (
            <p className="verify-clean"><CheckCircle2 size={17} aria-hidden="true" /> No page-count, size, text or visual differences were detected above the tolerance.</p>
          )}

          <div className="verify-actions">
            <button type="button" className="hero-cta" onClick={downloadReport}><Download size={15} aria-hidden="true" /> Download JSON report</button>
            {reportUrl ? <a className="text-link" href={reportUrl} download>Save the report file</a> : null}
          </div>

          <section className="verify-pages-section" aria-labelledby="verify-pages-heading">
            <div className="verify-pages-head">
              <h3 id="verify-pages-heading">Page by page</h3>
              <span className="route-note">Click a page to inspect it side by side.</span>
            </div>
            <ol className="verify-pages">
              {report.pages.map((page) => (
                <li key={page.page} className={`verify-page ${statusClass(page.status)}`}>
                  <span className="verify-page-number">Page {page.page}</span>
                  <span className={`verify-page-status ${statusClass(page.status)}`}>{statusLabel(page.status)}</span>
                  <span className="verify-page-metric">Visual {formatPercent(page.visualSimilarityPercent)}</span>
                  <span className="verify-page-metric">Text {formatPercent(page.textSimilarityPercent)}</span>
                  {page.textAddedWords || page.textRemovedWords ? (
                    <span className="verify-page-metric">+{page.textAddedWords} / −{page.textRemovedWords} words</span>
                  ) : null}
                  <button type="button" onClick={() => void openPreview(page.page)} disabled={previewBusy}>
                    Preview
                  </button>
                </li>
              ))}
            </ol>
          </section>

          {previewPage ? (
            <section className="verify-preview" aria-labelledby="verify-preview-heading">
              <div className="verify-pages-head">
                <h3 id="verify-preview-heading">Page {previewPage} side by side</h3>
                {previewBusy ? <span className="verify-status"><Loader2 size={14} className="is-spinning" aria-hidden="true" /> Rendering…</span> : null}
              </div>
              {preview ? (
                <div className="verify-preview-grid">
                  <figure>
                    <figcaption>Original</figcaption>
                    {preview.beforeUrl ? <img src={preview.beforeUrl} alt={`Original page ${previewPage}`} /> : <p className="route-note">This page is not in the original PDF.</p>}
                  </figure>
                  <figure>
                    <figcaption>Result</figcaption>
                    {preview.afterUrl ? <img src={preview.afterUrl} alt={`Result page ${previewPage}`} /> : <p className="route-note">This page is not in the result PDF.</p>}
                  </figure>
                </div>
              ) : null}
            </section>
          ) : null}

          <p className="verify-footnote"><ShieldCheck size={14} aria-hidden="true" /> Visual comparison is a rendered-page approximation, not a pixel-identical proof for print. Text comparison is word-based and case-insensitive.</p>
        </div>
      ) : null}
    </section>
  );
}
