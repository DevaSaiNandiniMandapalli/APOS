"use client";

import { useMemo, useRef, useState } from "react";
import {
  addStep,
  createWorkflow,
  moveStep,
  parseWorkflow,
  removeStep,
  serializeWorkflow,
  stepLabel,
  STEP_CATALOG,
  validateWorkflow,
  type StepType,
  type Workflow,
} from "@/lib/workflow";

export default function WorkflowBuilder() {
  const [workflow, setWorkflow] = useState<Workflow>(() => createWorkflow());
  const [type, setType] = useState<StepType>("merge");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const errors = useMemo(() => validateWorkflow(workflow), [workflow]);

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
        <ul className="workflow__errors" role="status">
          {errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
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
          </li>
        ))}
      </ol>
      {notice ? <p className="ocr__message" role="status">{notice}</p> : null}
      <p className="privacy-note">Design a repeatable sequence and export it as JSON. Steps run in order when executed; workflow definitions stay on your device.</p>
    </section>
  );
}
