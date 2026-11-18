export type StepType =
  | "merge"
  | "split"
  | "rotate"
  | "compress"
  | "organize"
  | "watermark"
  | "protect"
  | "extract-text"
  | "convert";

export type WorkflowStep = { id: string; type: StepType; options: Record<string, string> };
export type Workflow = { name: string; steps: WorkflowStep[] };

export type StepField = {
  name: string;
  label: string;
  kind: "text" | "select" | "number" | "password";
  default: string;
  choices?: { value: string; label: string }[];
  help?: string;
  required?: boolean;
};

export const STEP_CATALOG: { type: StepType; label: string; description: string }[] = [
  { type: "merge", label: "Merge PDFs", description: "Combine several PDFs into one file." },
  { type: "split", label: "Split PDF", description: "Split a PDF into separate documents." },
  { type: "rotate", label: "Rotate pages", description: "Rotate pages by 90° steps." },
  { type: "organize", label: "Organize pages", description: "Reorder, delete, extract or duplicate pages." },
  { type: "compress", label: "Compress", description: "Reduce the file size of a PDF." },
  { type: "watermark", label: "Watermark", description: "Stamp text onto every page." },
  { type: "protect", label: "Protect", description: "Encrypt the PDF with a password." },
  { type: "extract-text", label: "Extract text", description: "Pull the text layer into a file." },
  { type: "convert", label: "Convert", description: "Convert between supported formats." },
];

export const STEP_FIELDS: Record<StepType, StepField[]> = {
  merge: [],
  split: [
    { name: "mode", label: "Split mode", kind: "select", default: "each-page", choices: [
      { value: "each-page", label: "One file per page" },
      { value: "ranges", label: "Custom ranges" },
    ] },
    { name: "ranges", label: "Ranges", kind: "text", default: "1-2, 3", help: "Only used with custom ranges, e.g. 1-3, 5." },
  ],
  rotate: [
    { name: "angle", label: "Angle", kind: "select", default: "90", choices: [
      { value: "90", label: "90° clockwise" },
      { value: "180", label: "180°" },
      { value: "270", label: "270° clockwise" },
    ] },
    { name: "pages", label: "Pages", kind: "text", default: "", help: "Leave blank to rotate every page." },
  ],
  organize: [
    { name: "operation", label: "Operation", kind: "select", default: "delete", choices: [
      { value: "delete", label: "Delete pages" },
      { value: "reorder", label: "Reorder pages" },
      { value: "extract", label: "Extract pages" },
      { value: "duplicate", label: "Duplicate pages" },
    ] },
    { name: "pages", label: "Pages", kind: "text", default: "1", required: true, help: "Page numbers or ranges, e.g. 1-3, 5." },
  ],
  compress: [],
  watermark: [
    { name: "text", label: "Text", kind: "text", default: "CONFIDENTIAL", required: true },
    { name: "opacity", label: "Opacity", kind: "number", default: "0.25", help: "0.05 to 1." },
    { name: "rotation", label: "Rotation", kind: "number", default: "45", help: "Degrees." },
    { name: "pages", label: "Pages", kind: "text", default: "", help: "Leave blank for every page." },
  ],
  protect: [
    { name: "password", label: "Opening password", kind: "password", default: "", required: true, help: "At least 12 characters." },
    { name: "ownerPassword", label: "Owner password", kind: "password", default: "", help: "Optional. Defaults to the opening password plus -owner." },
  ],
  "extract-text": [],
  convert: [
    { name: "target", label: "Convert to", kind: "select", default: "pdf", choices: [
      { value: "pdf", label: "PDF" },
      { value: "docx", label: "Word (.docx)" },
      { value: "xlsx", label: "Excel (.xlsx)" },
      { value: "txt", label: "Plain text" },
      { value: "png", label: "PNG image" },
      { value: "jpeg", label: "JPG image" },
      { value: "webp", label: "WebP image" },
      { value: "html", label: "HTML" },
      { value: "csv", label: "CSV" },
    ] },
  ],
};

export function stepLabel(type: StepType): string {
  return STEP_CATALOG.find((step) => step.type === type)?.label ?? type;
}

export function defaultOptions(type: StepType): Record<string, string> {
  return Object.fromEntries(STEP_FIELDS[type].map((field) => [field.name, field.default]));
}

let counter = 0;

export function newStep(type: StepType): WorkflowStep {
  counter += 1;
  return { id: `step-${Date.now()}-${counter}`, type, options: defaultOptions(type) };
}

export function createWorkflow(): Workflow {
  return { name: "Untitled workflow", steps: [] };
}

export function addStep(workflow: Workflow, type: StepType): Workflow {
  return { ...workflow, steps: [...workflow.steps, newStep(type)] };
}

export function removeStep(workflow: Workflow, id: string): Workflow {
  return { ...workflow, steps: workflow.steps.filter((step) => step.id !== id) };
}

export function moveStep(workflow: Workflow, id: string, direction: -1 | 1): Workflow {
  const index = workflow.steps.findIndex((step) => step.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= workflow.steps.length) return workflow;
  const steps = [...workflow.steps];
  [steps[index], steps[target]] = [steps[target], steps[index]];
  return { ...workflow, steps };
}

export function updateStepOption(workflow: Workflow, id: string, name: string, value: string): Workflow {
  return {
    ...workflow,
    steps: workflow.steps.map((step) => (step.id === id ? { ...step, options: { ...step.options, [name]: value } } : step)),
  };
}

export function validateWorkflow(workflow: Workflow): string[] {
  const errors: string[] = [];
  if (!workflow.name.trim()) errors.push("Add a name for the workflow before saving.");
  if (workflow.steps.length === 0) errors.push("Add at least one step. Pick a tool from the palette, then save.");
  const known = new Set(STEP_CATALOG.map((step) => step.type));
  workflow.steps.forEach((step, index) => {
    if (!known.has(step.type)) {
      errors.push(`Step ${index + 1} (${step.type}) is not a supported tool in this workflow.`);
      return;
    }
    for (const field of STEP_FIELDS[step.type]) {
      if (field.required && !(step.options?.[field.name] ?? "").trim()) {
        errors.push(`Step ${index + 1} (${stepLabel(step.type)}) needs a value for ${field.label.toLowerCase()}.`);
      }
    }
  });
  return errors;
}

export function serializeWorkflow(workflow: Workflow): string {
  return JSON.stringify(workflow, null, 2);
}

export function parseWorkflow(text: string): { workflow: Workflow } | { error: string } {
  let data: { name?: unknown; steps?: unknown };
  try {
    data = JSON.parse(text) as { name?: unknown; steps?: unknown };
  } catch {
    return { error: "That file is not valid JSON. Export a workflow from APOS and open that file." };
  }
  try {
    if (!data || typeof data !== "object" || !Array.isArray(data.steps)) {
      return { error: "Not a valid workflow file. It needs a \"steps\" array — export one from APOS first." };
    }
    const known = new Set(STEP_CATALOG.map((step) => step.type));
    const steps: WorkflowStep[] = data.steps.map((item, index) => {
      const step = item as { type?: unknown; options?: unknown };
      if (typeof step.type !== "string" || !known.has(step.type as StepType)) {
        throw new Error(`Step ${index + 1} has an unknown type.`);
      }
      const type = step.type as StepType;
      const saved = step.options && typeof step.options === "object" ? (step.options as Record<string, unknown>) : {};
      const options = defaultOptions(type);
      for (const field of STEP_FIELDS[type]) {
        const value = saved[field.name];
        if (typeof value === "string") options[field.name] = value;
      }
      return { id: newStep(type).id, type, options };
    });
    return { workflow: { name: typeof data.name === "string" ? data.name : "Untitled workflow", steps } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not read that file." };
  }
}
