"use client";

import { useRef, useState } from "react";
import { normalizeOcrText, OCR_ACCEPT, validateOcrFile } from "@/lib/ocr";

type Status = "idle" | "running" | "done" | "error";

export default function OcrTool() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const pick = (next: File | null) => {
    setText("");
    setMessage("");
    setStatus("idle");
    if (!next) {
      setFile(null);
      return;
    }
    const problem = validateOcrFile(next);
    if (problem) {
      setFile(null);
      setStatus("error");
      setMessage(problem);
      return;
    }
    setFile(next);
  };

  const run = async () => {
    if (!file) {
      setStatus("error");
      setMessage("Choose an image first.");
      return;
    }
    setStatus("running");
    setMessage("Loading OCR engine…");
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      setMessage("Recognizing text…");
      const result = await worker.recognize(file);
      await worker.terminate();
      const clean = normalizeOcrText(result.data.text ?? "");
      setText(clean);
      setStatus("done");
      setMessage(clean ? "Text recognized." : "No text was detected in this image.");
    } catch {
      setStatus("error");
      setMessage("OCR failed. The language data may be unavailable offline.");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Copied to clipboard.");
    } catch {
      setMessage("Copy failed. Select the text manually.");
    }
  };

  const download = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${file?.name.replace(/\.[^.]+$/, "") || "ocr"}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="ocr" aria-label="OCR tool">
      <div className="ocr__actions">
        <button type="button" onClick={() => inputRef.current?.click()} disabled={status === "running"}>Choose image</button>
        <button type="button" className="ocr__run" onClick={() => void run()} disabled={!file || status === "running"}>
          {status === "running" ? "Working…" : "Extract text"}
        </button>
        {text ? <button type="button" onClick={() => void copy()}>Copy text</button> : null}
        {text ? <button type="button" onClick={download}>Download .txt</button> : null}
        <input
          ref={inputRef}
          type="file"
          accept={OCR_ACCEPT}
          className="ocr__file"
          aria-label="Choose image for OCR"
          onChange={(event) => {
            pick(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
      </div>

      {file ? <p className="ocr__file-name">{file.name}</p> : null}
      {message ? <p className={status === "error" ? "ai__error" : "ocr__message"} role="status">{message}</p> : null}

      <label className="sr-only" htmlFor="ocr-output">Recognized text</label>
      <textarea
        id="ocr-output"
        className="ocr__output"
        value={text}
        readOnly
        rows={12}
        placeholder="Recognized text will appear here."
      />
      <p className="privacy-note">OCR runs in your browser. The first run downloads English language data; nothing is uploaded.</p>
    </section>
  );
}
