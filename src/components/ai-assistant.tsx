"use client";

import { useState } from "react";
import { AI_TASKS, MAX_INPUT_CHARS, validateAiInput, type AiTask } from "@/lib/ai";

export default function AiAssistant() {
  const [task, setTask] = useState<AiTask>("summarize");
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    const inputError = validateAiInput(text);
    if (inputError) {
      setError(inputError);
      return;
    }
    setBusy(true);
    setAnswer("");
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, text }),
      });
      const data = (await response.json().catch(() => ({}))) as { answer?: string; error?: string };
      if (!response.ok) {
        setError(data.error ?? "The request failed.");
        return;
      }
      if (!data.answer) {
        setError("No answer was returned.");
        return;
      }
      setAnswer(data.answer);
    } catch {
      setError("Could not reach the AI service.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answer);
    } catch {
      setError("Copy failed. Select the text manually.");
    }
  };

  return (
    <section className="ai" aria-label="AI assistant">
      <div className="ai__controls">
        <label htmlFor="ai-task">Task</label>
        <select id="ai-task" value={task} onChange={(event) => setTask(event.target.value as AiTask)} disabled={busy}>
          {AI_TASKS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <span className="ai__count" aria-live="polite">{text.trim().length} / {MAX_INPUT_CHARS}</span>
      </div>

      <label className="sr-only" htmlFor="ai-input">Text to send</label>
      <textarea
        id="ai-input"
        className="ai__input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Paste a document excerpt, an email, or a question…"
        rows={10}
        maxLength={MAX_INPUT_CHARS}
        disabled={busy}
      />

      <div className="ai__actions">
        <button type="button" className="ai__submit" onClick={() => void submit()} disabled={busy}>
          {busy ? "Thinking…" : "Ask Sarvam 105B"}
        </button>
        <button type="button" onClick={() => { setText(""); setAnswer(""); setError(""); }} disabled={busy}>Clear</button>
        {answer ? <button type="button" onClick={() => void copy()}>Copy answer</button> : null}
      </div>

      {error ? <div className="ai__error" role="alert">{error}</div> : null}

      {answer ? (
        <div className="ai__answer" aria-live="polite">
          <h2>Answer</h2>
          <p>{answer}</p>
        </div>
      ) : (
        <p className="privacy-note">Your text is sent to a server-configured Sarvam 105B endpoint. The API key never reaches the browser.</p>
      )}
    </section>
  );
}
