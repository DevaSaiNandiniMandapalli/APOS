"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { zipSync } from "fflate";
import {
  addStep,
  createWorkflow,
  moveStep,
  parseWorkflow,
  removeStep,
  serializeWorkflow,
  stepLabel,
  STEP_CATALOG,
  STEP_FIELDS,
  updateStepOption,
  validateWorkflow,
  type StepType,
  type Workflow,
} from "@/lib/workflow";
import { runWorkflow, type StepReport, type WorkflowDocument } from "@/lib/workflow-run";

type Output = { name: string; url: string; size: number };

export default function WorkflowBuilder() {
  const [workflow, setWorkflow] = useState<Workflow>(() => createWorkflow());
  const [type, setType] = useState<StepType>("merge");
  const [notice, setNotice] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [reports, setReports] = useState<StepReport[]>([]);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const urlsRef = useRef<string[]>([]);

  const errors = useMemo(() => validateWorkflow(workflow), [workflow]);

  const clearOutputs = () => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
    setOutputs([]);
    setReports([]);
    setError("");
    setProgress("");
  };

  useEffect(() => () => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    controllerRef.current?.abort();
  }, []);

  const save = () => {
    const blob = new Blob([serializeWorkflow(workflow)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "workflow.apos.json";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Exported workflow.apos.json");
  };

  const open = async (file: File) => {
    const parsed = parseWorkflow(await file.text());
    if ("error" in parsed) {
      setNotice(parsed.error);
      return;
    }
    setWorkflow(parsed.workflow);
    setNotice(`Opened ${file.name}`);
  };

  const copyPlan = async () => {
    const plan = workflow.steps.map((step, index) => `${index + 1}. ${stepLabel(step.type)}`).join("\n");
    try {
      await navigator.clipboard.writeText(`${workflow.name}\n${plan}`);
      setNotice("Copied the step plan.");
    } catch {
      setNotice("Copy failed.");
    }
  };

  const run = async () => {
    if (busy) return;
    clearOutputs();
    if (errors.length) {
      setError(errors[0]);
      return;
    }
    if (!files.length) {
      setError("Choose at least one input file before running the workflow.");
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    try {
      const documents: WorkflowDocument[] = [];
      for (const file of files) {
        documents.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type || "application/octet-stream" });
      }
      const result = await runWorkflow(documents, workflow, {
        signal: controller.signal,
        onStep: (index, total, label) => setProgress(`Step ${index + 1} of ${total}: ${label}…`),
      });
      const created: Output[] = result.documents.map((document) => {
        const blob = new Blob([document.bytes.slice() as unknown as BlobPart], { type: document.mime });
        const url = URL.createObjectURL(blob);
        urlsRef.current.push(url);
        return { name: document.name, url, size: document.bytes.byteLength };
      });
      setOutputs(created);
      setReports(result.reports);
      setProgress(`Finished — ${created.length} output file${created.length === 1 ? "" : "s"}.`);
    } catch (reason) {
      if (controller.signal.aborted) {
        setProgress("Cancelled.");
        return;
      }
      setError(reason instanceof Error ? reason.message : "The workflow could not run.");
      setProgress("");
    } finally {
      setBusy(false);
      controllerRef.current = null;
    }
  };

  const downloadZip = () => {
    if (!outputs.length) return;
    void (async () => {
      const archive: Record<string, Uint8Array> = {};
      const used = new Set<string>();
      for (const [index, output] of outputs.entries()) {
        const name = used.has(output.name) ? `${index + 1}-${output.name}` : output.name;
        used.add(name);
        const response = await fetch(output.url);
        archive[name] = new Uint8Array(await response.arrayBuffer());
      }
      const bytes = zipSync(archive, { level: 0 });
      const url = URL.createObjectURL(new Blob([bytes.slice() as unknown as BlobPart], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${workflow.name.replace(/[^\w\-. ]+/g, "-") || "workflow"}-outputs.zip`;
      link.click();
      URL.revokeObjectURL(url);
    })();
  };

  return (
    <section className="workflow" aria-label="Workflow builder">
      <div className="workflow__bar">
        <label htmlFor="workflow-name">Name</label>
        <input
          id="workflow-name"
          value={workflow.name}
          onChange={(event) => setWorkflow((current) => ({ ...current, name: event.target.value }))}
          placeholder="Name this workflow"
        />
        <label htmlFor="workflow-step">Step</label>
        <select id="workflow-step" value={type} onChange={(event) => setType(event.target.value as StepType)}>
          {STEP_CATALOG.map((step) => <option key={step.type} value={step.type}>{step.label}</option>)}
        </select>
        <button type="button" onClick={() => setWorkflow((current) => addStep(current, type))}>Add step</button>
        <button type="button" onClick={() => void copyPlan()} disabled={workflow.steps.length === 0}>Copy plan</button>
        <button type="button" onClick={save}>Save JSON</button>
        <button type="button" onClick={() => fileRef.current?.click()}>Open JSON</button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="workflow__file"
          aria-label="Open workflow JSON"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void open(file);
            event.target.value = "";
          }}
        />
      </div>

      {errors.length ? (
        <div role="status">
          <ul className="workflow__errors">
            {errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      ) : (
        <p className="workflow__valid" role="status">Ready — {workflow.steps.length} step{workflow.steps.length === 1 ? "" : "s"}.</p>
      )}

      <ol className="workflow__steps">
        {workflow.steps.map((step, index) => (
          <li key={step.id}>
            <span className="workflow__index">{index + 1}</span>
            <span className="workflow__label">{stepLabel(step.type)}</span>
            <span className="workflow__hint">{STEP_CATALOG.find((item) => item.type === step.type)?.description}</span>
            <span className="workflow__step-actions">
              <button type="button" aria-label={`Move ${stepLabel(step.type)} up`} onClick={() => setWorkflow((current) => moveStep(current, step.id, -1))} disabled={index === 0}>↑</button>
              <button type="button" aria-label={`Move ${stepLabel(step.type)} down`} onClick={() => setWorkflow((current) => moveStep(current, step.id, 1))} disabled={index === workflow.steps.length - 1}>↓</button>
              <button type="button" aria-label={`Remove ${stepLabel(step.type)}`} onClick={() => setWorkflow((current) => removeStep(current, step.id))}>Remove</button>
            </span>
            {STEP_FIELDS[step.type].length > 0 && (
              <div className="workflow__options">
                {STEP_FIELDS[step.type].map((field) => (
                  <label key={field.name}>
                    <span>{field.label}</span>
                    {field.kind === "select" ? (
                      <select
                        aria-label={`${stepLabel(step.type)} ${field.label}`}
                        value={step.options[field.name] ?? field.default}
                        onChange={(event) => setWorkflow((current) => updateStepOption(current, step.id, field.name, event.target.value))}
                      >
                        {(field.choices ?? []).map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                      </select>
                    ) : (
                      <input
                        aria-label={`${stepLabel(step.type)} ${field.label}`}
                        type={field.kind === "password" ? "password" : field.kind === "number" ? "number" : "text"}
                        value={step.options[field.name] ?? field.default}
                        autoComplete="off"
                        onChange={(event) => setWorkflow((current) => updateStepOption(current, step.id, field.name, event.target.value))}
                      />
                    )}
                    {field.help ? <small className="route-note">{field.help}</small> : null}
                  </label>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="workflow__run">
        <label className="file-picker">
          Choose input files
          <input
            type="file"
            multiple
            disabled={busy}
            aria-label="Choose workflow input files"
            onChange={(event) => {
              clearOutputs();
              setFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </label>
        {files.length > 0 && <p className="route-note">{files.length} input file{files.length === 1 ? "" : "s"} selected: {files.map((file) => file.name).join(", ")}</p>}
        <div className="merge-actions">
          <button type="button" className="hero-cta" disabled={busy || !files.length || workflow.steps.length === 0} onClick={() => void run()}>
            {busy ? "Running…" : "Run workflow"}
          </button>
          {busy && <button type="button" onClick={() => controllerRef.current?.abort()}>Cancel</button>}
        </div>
        {progress ? <p role="status" aria-live="polite">{progress}</p> : null}
        {error ? <p role="alert" className="merge-error">{error}</p> : null}
      </div>

      {reports.length > 0 && (
        <ol className="workflow__reports">
          {reports.map((report) => (
            <li key={report.stepId} data-status={report.status}>
              <strong>{report.label}</strong> — {report.status === "ok" ? "done" : "failed"}: {report.message}
            </li>
          ))}
        </ol>
      )}

      {outputs.length > 0 && (
        <div className="merge-success">
          <p role="status">Download your results:</p>
          <ul>
            {outputs.map((output) => (
              <li key={output.url}>
                <a href={output.url} download={output.name}>{output.name}</a> <span className="route-note">({Math.max(1, Math.round(output.size / 1024))} KB)</span>
              </li>
            ))}
          </ul>
          {outputs.length > 1 && <button type="button" onClick={downloadZip}>Download all as ZIP</button>}
        </div>
      )}

      {notice ? <p className="ocr__message" role="status">{notice}</p> : null}
      <p className="privacy-note">Design a repeatable sequence, then run it on your own files. Every step runs in this browser; nothing is uploaded and workflow definitions stay on your device.</p>
    </section>
  );
}
