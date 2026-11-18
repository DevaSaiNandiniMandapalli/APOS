import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { addStep, createWorkflow, updateStepOption, type Workflow } from "./workflow";
import { runWorkflow, type WorkflowDocument } from "./workflow-run";

async function makePdf(pages: number, label = "Page"): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) {
    pdf.addPage([300, 400]);
  }
  void label;
  return new Uint8Array(await pdf.save());
}

async function pageCount(bytes: Uint8Array) {
  return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
}

function doc(name: string, bytes: Uint8Array): WorkflowDocument {
  return { name, bytes, mime: "application/pdf" };
}

function withOptions(workflow: Workflow, stepIndex: number, options: Record<string, string>): Workflow {
  let next = workflow;
  const step = next.steps[stepIndex];
  for (const [name, value] of Object.entries(options)) {
    next = updateStepOption(next, step.id, name, value);
  }
  return next;
}

describe("workflow runner", () => {
  it("merges every input into one document", async () => {
    const workflow = addStep(createWorkflow(), "merge");
    const result = await runWorkflow([doc("a.pdf", await makePdf(2)), doc("b.pdf", await makePdf(1))], workflow);
    expect(result.documents).toHaveLength(1);
    expect(await pageCount(result.documents[0].bytes)).toBe(3);
    expect(result.reports[0].status).toBe("ok");
  });

  it("runs several steps in order", async () => {
    let workflow = createWorkflow();
    workflow = addStep(workflow, "merge");
    workflow = addStep(workflow, "rotate");
    workflow = addStep(workflow, "compress");
    const result = await runWorkflow([doc("a.pdf", await makePdf(1)), doc("b.pdf", await makePdf(1))], workflow);
    expect(result.reports.map((report) => report.status)).toEqual(["ok", "ok", "ok"]);
    expect(await pageCount(result.documents[0].bytes)).toBe(2);
  });

  it("deletes the requested pages", async () => {
    let workflow = addStep(createWorkflow(), "organize");
    workflow = withOptions(workflow, 0, { operation: "delete", pages: "1" });
    const result = await runWorkflow([doc("a.pdf", await makePdf(3))], workflow);
    expect(await pageCount(result.documents[0].bytes)).toBe(2);
  });

  it("splits into one file per page", async () => {
    const workflow = addStep(createWorkflow(), "split");
    const result = await runWorkflow([doc("a.pdf", await makePdf(3))], workflow);
    expect(result.documents).toHaveLength(3);
    expect(result.documents.map((document) => document.name)).toEqual(["a-p1.pdf", "a-p2.pdf", "a-p3.pdf"]);
  });

  it("encrypts with the protect step", async () => {
    let workflow = addStep(createWorkflow(), "protect");
    workflow = withOptions(workflow, 0, { password: "a-long-enough-password" });
    const result = await runWorkflow([doc("a.pdf", await makePdf(1))], workflow);
    await expect(PDFDocument.load(result.documents[0].bytes)).rejects.toBeTruthy();
    const opened = await PDFDocument.load(result.documents[0].bytes, { password: "a-long-enough-password" });
    expect(opened.getPageCount()).toBe(1);
  });

  it("stops and reports the failing step", async () => {
    let workflow = createWorkflow();
    workflow = addStep(workflow, "merge");
    workflow = addStep(workflow, "organize");
    workflow = withOptions(workflow, 1, { operation: "delete", pages: "99" });
    await expect(runWorkflow([doc("a.pdf", await makePdf(1)), doc("b.pdf", await makePdf(1))], workflow))
      .rejects.toThrow(/Step 2 \(Organize pages\) failed/);
  });

  it("refuses a PDF step on non-PDF input with a clear message", async () => {
    const workflow = addStep(createWorkflow(), "compress");
    const text: WorkflowDocument = { name: "notes.txt", bytes: new TextEncoder().encode("hello"), mime: "text/plain" };
    await expect(runWorkflow([text], workflow)).rejects.toThrow(/needs PDF input/);
  });

  it("requires input files and at least one step", async () => {
    await expect(runWorkflow([], addStep(createWorkflow(), "merge"))).rejects.toThrow(/at least one input file/);
    await expect(runWorkflow([doc("a.pdf", await makePdf(1))], createWorkflow())).rejects.toThrow(/at least one step/);
  });
});
