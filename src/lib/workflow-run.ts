import { PDFDocument } from "@cantoo/pdf-lib";
import { compressPdfBuffer } from "./compress-pdf";
import { mergePdfBuffers } from "./merge-pdf";
import { markPdf } from "./pdf-marking";
import { organizePdfBuffer, type PageOperation } from "./organize-pdf";
import { protectPdf } from "./pdf-security";
import { convertPdfFileToText } from "./pdf-to-text";
import { rotatePdfPages } from "./rotate-pdf";
import { splitPdfBuffer, type PageRange } from "./split-pdf";
import { convertUniversal, type Target } from "./universal-convert";
import { stepLabel, type Workflow, type WorkflowStep } from "./workflow";

/** One document travelling through the pipeline. */
export type WorkflowDocument = { name: string; bytes: Uint8Array; mime: string };

export type StepReport = {
  stepId: string;
  type: WorkflowStep["type"];
  label: string;
  status: "ok" | "failed";
  message: string;
  documentCount: number;
};

export type WorkflowRunResult = { documents: WorkflowDocument[]; reports: StepReport[] };

export type RunOptions = {
  signal?: AbortSignal;
  onStep?: (index: number, total: number, label: string) => void;
};

const PDF_MIME = "application/pdf";
const TEXT_MIME = "text/plain;charset=utf-8";

function stem(name: string) {
  return (name.replace(/\.[^.]+$/, "") || "document").replace(/[^\w\-. ]+/g, "-").slice(0, 60) || "document";
}

function asFile(document: WorkflowDocument): File {
  const copy = document.bytes.slice();
  return new File([copy as unknown as BlobPart], document.name, { type: document.mime });
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Workflow cancelled", "AbortError");
}

async function pageCountOf(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  return pdf.getPageCount();
}

function option(step: WorkflowStep, key: string, fallback: string) {
  const value = step.options?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** Splits every document into the requested ranges, one output per range. */
async function splitDocuments(documents: WorkflowDocument[], step: WorkflowStep, signal?: AbortSignal) {
  const mode = option(step, "mode", "each-page");
  const outputs: WorkflowDocument[] = [];
  for (const document of documents) {
    assertNotAborted(signal);
    const count = await pageCountOf(document.bytes);
    const ranges: PageRange[] = mode === "ranges"
      ? (await import("./split-pdf")).parsePageRanges(option(step, "ranges", `1-${count}`), count)
      : Array.from({ length: count }, (_, index) => ({ first: index + 1, last: index + 1 }));
    const parts = await splitPdfBuffer(document.bytes, ranges);
    parts.forEach((bytes, index) => {
      const range = ranges[index];
      const suffix = range.first === range.last ? `p${range.first}` : `p${range.first}-${range.last}`;
      outputs.push({ name: `${stem(document.name)}-${suffix}.pdf`, bytes, mime: PDF_MIME });
    });
  }
  return outputs;
}

async function rotateDocuments(documents: WorkflowDocument[], step: WorkflowStep, signal?: AbortSignal) {
  const angle = Number(option(step, "angle", "90"));
  if (![90, 180, 270].includes(angle)) throw new Error("Rotation must be 90, 180 or 270 degrees.");
  const pages = option(step, "pages", "");
  const outputs: WorkflowDocument[] = [];
  for (const document of documents) {
    assertNotAborted(signal);
    const count = await pageCountOf(document.bytes);
    const rotations: Record<number, number> = {};
    const targets = pages
      ? (await import("./split-pdf")).parsePageRanges(pages, count).flatMap(({ first, last }) =>
          Array.from({ length: last - first + 1 }, (_, index) => first + index))
      : Array.from({ length: count }, (_, index) => index + 1);
    for (const page of targets) rotations[page] = angle;
    outputs.push({ name: document.name, bytes: (await rotatePdfPages(document.bytes, rotations)).bytes, mime: PDF_MIME });
  }
  return outputs;
}

async function organizeDocuments(documents: WorkflowDocument[], step: WorkflowStep, signal?: AbortSignal) {
  const operation = option(step, "operation", "delete") as PageOperation;
  if (!["delete", "reorder", "extract", "duplicate"].includes(operation)) {
    throw new Error("Choose delete, reorder, extract or duplicate for the organize step.");
  }
  const pages = option(step, "pages", "");
  if (!pages) throw new Error(`The ${operation} step needs page numbers such as 1-3, 5.`);
  const outputs: WorkflowDocument[] = [];
  for (const document of documents) {
    assertNotAborted(signal);
    outputs.push({ name: document.name, bytes: (await organizePdfBuffer(document.bytes, { operation, pages })).bytes, mime: PDF_MIME });
  }
  return outputs;
}

async function watermarkDocuments(documents: WorkflowDocument[], step: WorkflowStep, signal?: AbortSignal) {
  const text = option(step, "text", "CONFIDENTIAL");
  const opacity = Number(option(step, "opacity", "0.25"));
  const rotation = Number(option(step, "rotation", "45"));
  const outputs: WorkflowDocument[] = [];
  for (const document of documents) {
    assertNotAborted(signal);
    const bytes = await markPdf(document.bytes, {
      operation: "watermark",
      mode: "text",
      text,
      pages: option(step, "pages", ""),
      position: "center",
      rotation: Number.isFinite(rotation) ? rotation : 45,
      opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.05, opacity)) : 0.25,
      fontSize: 48,
      startNumber: 1,
      color: "#8a8a8a",
    });
    outputs.push({ name: document.name, bytes, mime: PDF_MIME });
  }
  return outputs;
}

async function protectDocuments(documents: WorkflowDocument[], step: WorkflowStep, signal?: AbortSignal) {
  const password = option(step, "password", "");
  if (password.length < 12) throw new Error("The protect step needs an opening password of at least 12 characters.");
  const owner = option(step, "ownerPassword", `${password}-owner`);
  if (owner === password) throw new Error("The protect step needs a different owner password.");
  const outputs: WorkflowDocument[] = [];
  for (const document of documents) {
    assertNotAborted(signal);
    outputs.push({ name: document.name, bytes: await protectPdf(document.bytes, password, owner), mime: PDF_MIME });
  }
  return outputs;
}

async function extractTextDocuments(documents: WorkflowDocument[], signal?: AbortSignal) {
  const outputs: WorkflowDocument[] = [];
  for (const document of documents) {
    assertNotAborted(signal);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const result = await convertPdfFileToText(asFile(document), { includePageLabels: true }, controller.signal, () => {});
      outputs.push({ name: `${stem(document.name)}.txt`, bytes: result.bytes, mime: TEXT_MIME });
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }
  return outputs;
}

async function convertDocuments(documents: WorkflowDocument[], step: WorkflowStep, signal?: AbortSignal) {
  const target = option(step, "target", "pdf") as Target;
  const outputs: WorkflowDocument[] = [];
  for (const document of documents) {
    assertNotAborted(signal);
    const result = await convertUniversal(asFile(document), target, { signal: signal ?? new AbortController().signal, onProgress: () => {} });
    outputs.push({ name: result.fileName, bytes: result.bytes, mime: result.mime });
  }
  return outputs;
}

function describeOutputs(documents: WorkflowDocument[]) {
  if (documents.length === 1) return `1 document (${documents[0].name})`;
  return `${documents.length} documents`;
}

/**
 * Runs every step in order over the working set of documents.
 * A failing step stops the run and reports which step failed and why.
 */
export async function runWorkflow(
  input: WorkflowDocument[],
  workflow: Workflow,
  options: RunOptions = {},
): Promise<WorkflowRunResult> {
  if (!input.length) throw new Error("Choose at least one input file before running the workflow.");
  if (!workflow.steps.length) throw new Error("Add at least one step before running the workflow.");

  let documents = input;
  const reports: StepReport[] = [];

  for (let index = 0; index < workflow.steps.length; index += 1) {
    const step = workflow.steps[index];
    const label = stepLabel(step.type);
    options.onStep?.(index, workflow.steps.length, label);
    assertNotAborted(options.signal);

    const nonPdf = documents.find((document) => document.mime !== PDF_MIME);
    if (nonPdf && step.type !== "convert") {
      const message = `"${label}" needs PDF input, but "${nonPdf.name}" is not a PDF. Put the step that creates it last.`;
      reports.push({ stepId: step.id, type: step.type, label, status: "failed", message, documentCount: documents.length });
      throw new Error(message);
    }

    try {
      let next: WorkflowDocument[];
      switch (step.type) {
        case "merge":
          if (documents.length < 2) throw new Error("The merge step needs at least two PDFs. Add more input files.");
          next = [{ name: `${stem(documents[0].name)}-merged.pdf`, bytes: (await mergePdfBuffers(documents.map((document) => document.bytes))).bytes, mime: PDF_MIME }];
          break;
        case "split":
          next = await splitDocuments(documents, step, options.signal);
          break;
        case "rotate":
          next = await rotateDocuments(documents, step, options.signal);
          break;
        case "organize":
          next = await organizeDocuments(documents, step, options.signal);
          break;
        case "compress":
          next = [];
          for (const document of documents) {
            assertNotAborted(options.signal);
            const result = await compressPdfBuffer(document.bytes);
            next.push({ name: document.name, bytes: result.bytes, mime: PDF_MIME });
          }
          break;
        case "watermark":
          next = await watermarkDocuments(documents, step, options.signal);
          break;
        case "protect":
          next = await protectDocuments(documents, step, options.signal);
          break;
        case "extract-text":
          next = await extractTextDocuments(documents, options.signal);
          break;
        case "convert":
          next = await convertDocuments(documents, step, options.signal);
          break;
        default:
          throw new Error(`Unknown workflow step "${step.type}".`);
      }
      documents = next;
      reports.push({ stepId: step.id, type: step.type, label, status: "ok", message: describeOutputs(next), documentCount: next.length });
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
      const message = reason instanceof Error ? reason.message : "This step failed.";
      reports.push({ stepId: step.id, type: step.type, label, status: "failed", message, documentCount: documents.length });
      throw new Error(`Step ${index + 1} (${label}) failed: ${message}`);
    }
  }

  return { documents, reports };
}
