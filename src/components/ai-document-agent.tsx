"use client";

import { useRef, useState } from "react";
import { extractDocumentText, isSupportedDocumentName, SUMMARY_INPUT_LIMIT } from "@/lib/document-text";
import { buildAgentDocx, blocksToPlainText, parseMarkdownBlocks } from "@/lib/agent-docx";

const PRESETS: { label: string; instructions: string }[] = [
  { label: "Formal letter", instructions: "Produce a formal business letter with a subject line, salutation, body paragraphs and a closing. Keep every fact from the source." },
  { label: "Meeting minutes", instructions: "Produce meeting minutes with an 'Attendees', 'Decisions' and 'Action items' section. Put action items in a table." },
  { label: "Report with tables", instructions: "Produce a structured report with a title, numbered sections and any numbers presented as a table." },
  { label: "Clean up text", instructions: "Keep the meaning and order of the source, but fix grammar, spelling and spacing, and use headings where natural." },
];

export default function AiDocumentAgent() {
  const [file, setFile] = useState<File | null>(null);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ markdown: string; plain: string; blocks: number; name: string; url: string } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  const resetOutput = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setResult(null);
  };

  const pick = (selected: File | undefined) => {
    resetOutput(); setError(""); setStage("");
    setFile(selected ?? null);
  };

  const run = async () => {
    if (!file || busy) return;
    if (!instructions.trim()) { setError("Describe what the new document should contain."); return; }
    resetOutput(); setError(""); setBusy(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      setStage("Reading the source document…");
      const extracted = await extractDocumentText(file, controller.signal, setStage);
      if (controller.signal.aborted) return;
      if (!extracted.text.trim()) throw new Error("No readable text was found. Scan the pages with OCR PDF first.");

      const excerpt = extracted.text.slice(0, SUMMARY_INPUT_LIMIT);
      const truncated = extracted.text.length > excerpt.length;
      setStage("Asking Sarvam 105B to write the document…");
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "document", text: excerpt, instructions }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as { answer?: string; error?: string };
      if (!response.ok || !payload.answer) throw new Error(payload.error ?? "The AI could not produce a document.");
      if (controller.signal.aborted) return;

      const blocks = parseMarkdownBlocks(payload.answer);
      if (!blocks.length) throw new Error("The AI returned no usable content. Try more specific instructions.");
      const bytes = buildAgentDocx(payload.answer, file.name.replace(/\.[^.]+$/, ""));
      const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
      urlRef.current = url;
      setResult({
        markdown: payload.answer,
        plain: blocksToPlainText(blocks),
        blocks: blocks.length,
        name: `${file.name.replace(/\.[^.]+$/, "") || "document"}-edited.docx`,
        url,
      });
      setStage(truncated ? "Done — the source was longer than the AI input limit, so only its opening was used." : "Done.");
    } catch (reason) {
      if (controller.signal.aborted) { setError("Cancelled."); return; }
      setError(reason instanceof Error ? reason.message : "The document could not be generated.");
    } finally {
      setBusy(false);
      controllerRef.current = null;
    }
  };

  return (
    <section className="agent" aria-labelledby="agent-heading">
      <h2 id="agent-heading">AI document agent</h2>
      <p>
        Give it a PDF, Word or text file plus plain-language instructions, and it writes a new Word document that follows them — real headings, lists and tables.
      </p>
      <div className="privacy-note">
        The file is read on this device. Only the extracted text (first 12,000 characters) and your instructions are sent to Sarvam 105B to write the document.
      </div>

      <label className="file-picker">
        Source document
        <input
          type="file"
          accept=".pdf,.docx,.txt,.md,.csv,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,application/json"
          disabled={busy}
          onChange={(event) => { pick(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}
        />
      </label>

      <div className="agent__presets">
        {PRESETS.map((preset) => (
          <button key={preset.label} type="button" disabled={busy} onClick={() => setInstructions(preset.instructions)}>
            {preset.label}
          </button>
        ))}
      </div>

      <label className="agent__label" htmlFor="agent-instructions">What should the new document contain?</label>
      <textarea
        id="agent-instructions"
        rows={4}
        value={instructions}
        disabled={busy}
        maxLength={2000}
        placeholder="e.g. Convert this into a one-page summary letter addressed to the client, with a table of the charges."
        onChange={(event) => setInstructions(event.currentTarget.value)}
      />

      <div className="agent__actions">
        <button type="button" className="hero-cta" disabled={!file || busy || !instructions.trim()} onClick={() => void run()}>
          {busy ? "Working…" : "Generate Word document"}
        </button>
        {busy && <button type="button" onClick={() => controllerRef.current?.abort()}>Cancel</button>}
        {file && <span className="agent__file">{file.name}</span>}
      </div>

      {stage && <p role="status" aria-live="polite">{stage}</p>}
      {error && <p role="alert" className="merge-error">{error}</p>}

      {result && (
        <div className="agent__result">
          <h3>Draft ({result.blocks} block{result.blocks === 1 ? "" : "s"})</h3>
          <pre className="agent__preview">{result.plain.slice(0, 2000)}</pre>
          <a className="hero-cta" href={result.url} download={result.name}>Download {result.name}</a>
        </div>
      )}
    </section>
  );
}
