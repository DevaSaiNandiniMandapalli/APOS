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

export type WorkflowStep = { id: string; type: StepType };
export type Workflow = { name: string; steps: WorkflowStep[] };

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

export function stepLabel(type: StepType): string {
  return STEP_CATALOG.find((step) => step.type === type)?.label ?? type;
}

let counter = 0;

export function newStep(type: StepType): WorkflowStep {
  counter += 1;
  return { id: `step-${Date.now()}-${counter}`, type };
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

export function validateWorkflow(workflow: Workflow): string[] {
  const errors: string[] = [];
  if (!workflow.name.trim()) errors.push("Give the workflow a name.");
  if (workflow.steps.length === 0) errors.push("Add at least one step.");
  const known = new Set(STEP_CATALOG.map((step) => step.type));
  workflow.steps.forEach((step, index) => {
    if (!known.has(step.type)) errors.push(`Step ${index + 1} is not supported.`);
  });
  return errors;
}

export function serializeWorkflow(workflow: Workflow): string {
  return JSON.stringify(workflow, null, 2);
}

export function parseWorkflow(text: string): { workflow: Workflow } | { error: string } {
  try {
    const data = JSON.parse(text) as { name?: unknown; steps?: unknown };
    if (!data || typeof data !== "object" || !Array.isArray(data.steps)) {
      return { error: "Not a valid workflow file." };
    }
    const known = new Set(STEP_CATALOG.map((step) => step.type));
    const steps: WorkflowStep[] = data.steps.map((item, index) => {
      const step = item as { type?: unknown };
      if (typeof step.type !== "string" || !known.has(step.type as StepType)) {
        throw new Error(`Step ${index + 1} has an unknown type.`);
      }
      return newStep(step.type as StepType);
    });
    return { workflow: { name: typeof data.name === "string" ? data.name : "Untitled workflow", steps } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not read that file." };
  }
}
