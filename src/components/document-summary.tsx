"use client";

import { useRef, useState } from "react";
import { MAX_INPUT_CHARS, validateAiInput, type AiTask } from "@/lib/ai";
import {
  SUMMARY_INPUT_LIMIT,
  buildExcerpt,
  extractDocumentText,
  isSupportedDocumentName,
  type ExtractedDocument,
} from "@/lib/document-text";

type Status = "idle" | "reading" | "ready" | "asking";

async function askAi(task: AiTask, text: string): Promise<string> {
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, text }),
  });
  const data = (await response.json().catch(() => ({}))) as { answer?: string; error?: string };
  if (!response.ok) throw new Error(data.error ?? `The request failed (${response.status}).`);
  if (!data.answer) throw new Error("No answer was returned.");
  return data.answer;
}

export default function DocumentSummary() {
  const [doc, setDoc] = useState<ExtractedDocument | null>(null);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [copied, setCopied] = useState(false);
  const [question, setQuestion] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setDoc(null); setFileName(""); setAnswer(""); setError(""); setMessage(""); setQuestion(""); setStatus("idle");
  };

  const load = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setFileName(file.name);
    if (!isSupportedDocumentName(file.name)) {
      setError("Use a PDF, Word (.docx), text, Markdown, CSV or JSON file.");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("reading");
    try {
      const extracted = await extractDocumentText(file, controller.signal, setMessage);
      if (controller.signal.aborted) return;
      if (!extracted.text) {
        setError("No selectable text was found in this file. Scanned pages need the OCR PDF tool first.");
        setStatus("idle");
        return;
      }
      setDoc(extracted);
      setStatus("ready");
      setMessage("");
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "The file could not be read.");
      setStatus("idle");
    }
  };

  const summarize = async () => {
    if (!doc) return;
    const { excerpt, truncated, totalCharacters } = buildExcerpt(doc.text);
    const problem = validateAiInput(excerpt);
    if (problem) { setError(problem); return; }
    setError(""); setAnswer(""); setStatus("asking");
    try {
      const result = await askAi("summarize", `${truncated ? `This is the first ${excerpt.length} characters of a ${totalCharacters}-character document.\n\n` : ""}${excerpt}`);
      setAnswer(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The summary could not be generated.");
    } finally {
      setStatus("ready");
    }
  };

  const followUp = async () => {
    if (!doc || !question.trim()) return;
    const { excerpt, truncated } = buildExcerpt(doc.text);
    const problem = validateAiInput(`${question}\n\n${excerpt}`);
    if (problem) { setError(problem); return; }
    setError(""); setAnswer(""); setStatus("asking");
    try {
      const result = await askAi("chat", `Question: ${question}\n\nDocument${truncated ? " (excerpt)" : ""}:\n${excerpt}`);
      setAnswer(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The question could not be answered.");
    } finally {
      setStatus("ready");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Copy failed. Select the text manually.");
    }
  };

  const download = () => {
    const blob = new Blob([`# Summary — ${fileName}\n\n${answer}\n`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileName.replace(/\.[^.]+$/, "") || "document"}-summary.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const busy = status === "reading" || status === "asking";

  return (
    <section className="ai" aria-label="Document summary">
      <p>Upload a PDF, Word document or text file and get a concise summary from Sarvam 105B. File text is extracted in this browser and only the excerpt is sent to the AI endpoint.</p>
      <div className="privacy-note">
        Limit: {SUMMARY_INPUT_LIMIT.toLocaleString()} characters of extracted text per request ({MAX_INPUT_CHARS.toLocaleString()} is the API ceiling). Longer documents are summarized from their opening section, and that is stated in the result.
      </div>
      <label className="file-picker">
        Choose a document
        <input
          type="file"
          accept=".pdf,.docx,.txt,.md,.csv,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,application/json"
          disabled={busy}
          onChange={(event) => { void load(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}
        />
      </label>

      {busy && status === "reading" && <p role="status" aria-live="polite">{message || "Reading the document…"}</p>}

      {doc && (
        <>
          <p className="ai__count" aria-live="polite">
            {fileName} · {doc.pages ? `${doc.pages} pages · ` : ""}{doc.text.length.toLocaleString()} characters extracted
            {doc.text.length > SUMMARY_INPUT_LIMIT ? " · the summary uses the opening section" : ""}
          </p>
          <div className="ai__controls">
            <button type="button" className="hero-cta" disabled={busy} onClick={() => void summarize()}>
              {status === "asking" ? "Asking Sarvam 105B…" : "Summarize with Sarvam 105B"}
            </button>
            <button type="button" onClick={reset} disabled={busy}>Choose another file</button>
          </div>

          <div className="ai__controls">
            <label htmlFor="summary-question">Ask about this document</label>
            <input
              id="summary-question"
              type="text"
              value={question}
              maxLength={400}
              placeholder="e.g. What are the payment terms?"
              disabled={busy}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void followUp(); } }}
            />
            <button type="button" disabled={busy || !question.trim()} onClick={() => void followUp()}>Ask</button>
          </div>
        </>
      )}

      {error && <p role="alert" className="ai__error">{error}</p>}

      {answer && (
        <div className="ai__result" aria-live="polite">
          <h2>Result</h2>
          <p className="ai__answer">{answer}</p>
          <div className="ai__controls">
            <button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
            <button type="button" onClick={download}>Download .md</button>
          </div>
        </div>
      )}
    </section>
  );
}
