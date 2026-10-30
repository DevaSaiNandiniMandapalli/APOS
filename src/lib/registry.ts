import { z } from "zod";

export const studioDefinitions = [
  { id: "pdf-essentials", name: "PDF Essentials", description: "Everyday tools for working with PDF files.", icon: "FileText", accent: "violet" },
  { id: "pdf-conversion", name: "PDF Conversion", description: "Move documents between PDF and other formats.", icon: "Repeat2", accent: "blue" },
  { id: "pdf-editor", name: "PDF Editor", description: "Review and refine document content.", icon: "PenLine", accent: "orange" },
  { id: "pdf-organizer-layout", name: "PDF Organizer & Layout", description: "Arrange pages and shape document layouts.", icon: "PanelsTopLeft", accent: "green" },
  { id: "pdf-security-signature", name: "PDF Security & Signature", description: "Protect files and manage signatures.", icon: "ShieldCheck", accent: "rose" },
  { id: "pdf-repair-optimization", name: "PDF Repair & Optimization", description: "Improve file health and reduce document size.", icon: "Sparkles", accent: "cyan" },
  { id: "image-studio", name: "Image Studio", description: "Prepare images for documents and sharing.", icon: "Image", accent: "pink" },
  { id: "ocr-scanning-studio", name: "OCR & Scanning Studio", description: "Turn scans into searchable documents.", icon: "ScanText", accent: "amber" },
  { id: "document-studio", name: "Document Studio", description: "Work with text documents and common formats.", icon: "FileType", accent: "indigo" },
  { id: "spreadsheet-studio", name: "Spreadsheet Studio", description: "Tools for spreadsheet files and data.", icon: "Table2", accent: "emerald" },
  { id: "presentation-studio", name: "Presentation Studio", description: "Prepare and share presentation files.", icon: "Presentation", accent: "fuchsia" },
  { id: "ai-studio", name: "AI Studio", description: "Explore thoughtful AI assistance for documents.", icon: "WandSparkles", accent: "purple" },
  { id: "automation-studio", name: "Automation Studio", description: "Build repeatable document workflows.", icon: "Workflow", accent: "teal" },
  { id: "utility-studio", name: "Utility Studio", description: "Small utilities for everyday office work.", icon: "Wrench", accent: "slate" },
  { id: "developer-studio", name: "Developer Studio", description: "Document utilities for technical workflows.", icon: "Code2", accent: "lime" }
] as const;

export type StudioId = typeof studioDefinitions[number]["id"];
export const studioById = Object.fromEntries(studioDefinitions.map((studio) => [studio.id, studio])) as Record<StudioId, typeof studioDefinitions[number]>;

export const exhaustiveStudioCoverage = {
  "pdf-essentials": true,
  "pdf-conversion": true,
  "pdf-editor": true,
  "pdf-organizer-layout": true,
  "pdf-security-signature": true,
  "pdf-repair-optimization": true,
  "image-studio": true,
  "ocr-scanning-studio": true,
  "document-studio": true,
  "spreadsheet-studio": true,
  "presentation-studio": true,
  "ai-studio": true,
  "automation-studio": true,
  "utility-studio": true,
  "developer-studio": true
} satisfies Record<StudioId, true>;

export const toolDefinitions = [
  { id: "merge-pdf", name: "Merge PDF", studioId: "pdf-essentials", description: "Combine PDF documents into a single file.", status: "planned", icon: "Combine" },
  { id: "pdf-to-office", name: "PDF to Office", studioId: "pdf-conversion", description: "Convert PDF content into editable office formats.", status: "planned", icon: "ArrowRightLeft" },
  { id: "edit-pdf", name: "Edit PDF", studioId: "pdf-editor", description: "Make precise text and annotation changes.", status: "planned", icon: "FilePenLine" },
  { id: "organize-pages", name: "Organize pages", studioId: "pdf-organizer-layout", description: "Reorder, rotate, and remove document pages.", status: "planned", icon: "LayoutGrid" },
  { id: "sign-pdf", name: "Sign PDF", studioId: "pdf-security-signature", description: "Add a signature to a PDF document.", status: "planned", icon: "PenTool" },
  { id: "compress-pdf", name: "Compress PDF", studioId: "pdf-repair-optimization", description: "Reduce PDF file size while preserving readability.", status: "planned", icon: "Minimize2" },
  { id: "image-converter", name: "Image converter", studioId: "image-studio", description: "Convert common image formats for your workflow.", status: "planned", icon: "ImagePlus" },
  { id: "ocr-pdf", name: "OCR PDF", studioId: "ocr-scanning-studio", description: "Recognize text in scanned documents.", status: "planned", icon: "ScanLine" },
  { id: "document-to-pdf", name: "Document to PDF", studioId: "document-studio", description: "Create a PDF from a text document.", status: "planned", icon: "FileOutput" },
  { id: "spreadsheet-to-pdf", name: "Spreadsheet to PDF", studioId: "spreadsheet-studio", description: "Prepare a spreadsheet as a PDF document.", status: "planned", icon: "Sheet" },
  { id: "presentation-to-pdf", name: "Presentation to PDF", studioId: "presentation-studio", description: "Export slides into a shareable PDF.", status: "planned", icon: "Presentation" },
  { id: "document-summary", name: "Document summary", studioId: "ai-studio", description: "Get a concise summary of a document.", status: "planned", icon: "ListChecks" },
  { id: "workflow-builder", name: "Workflow builder", studioId: "automation-studio", description: "Connect document steps into repeatable workflows.", status: "planned", icon: "Workflow" },
  { id: "file-inspector", name: "File inspector", studioId: "utility-studio", description: "Review basic properties of a document file.", status: "planned", icon: "ScanSearch" },
  { id: "pdf-metadata", name: "PDF metadata", studioId: "developer-studio", description: "Inspect and manage PDF document metadata.", status: "planned", icon: "Braces" }
] as const;

const studioSchema = z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string().min(1), icon: z.string().min(1), accent: z.string().min(1) }).strict();
const statusSchema = z.enum(["planned", "in-development", "available", "unavailable"]);
const toolSchema = z.object({ id: z.string().min(1), name: z.string().min(1), studioId: z.string().min(1), description: z.string().min(1), status: statusSchema, icon: z.string().min(1), unavailableReason: z.string().min(1).optional() }).strict().superRefine((tool, ctx) => {
  if (tool.status === "unavailable" && !tool.unavailableReason) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unavailableReason"], message: "Unavailable tools need an explanation." });
});

export function validateRegistry(studios: unknown, tools: unknown) {
  const parsedStudios = z.array(studioSchema).min(1).parse(studios);
  const parsedTools = z.array(toolSchema).parse(tools);
  const studioIds = new Set(parsedStudios.map((studio) => studio.id));
  const toolStudioIds = new Set(studioIds);
  if (studioIds.size !== parsedStudios.length) throw new Error("Studio IDs must be unique.");
  if (new Set(parsedTools.map((tool) => tool.id)).size !== parsedTools.length) throw new Error("Tool IDs must be unique.");
  for (const tool of parsedTools) if (!toolStudioIds.has(tool.studioId)) throw new Error(`Unknown studio: ${tool.studioId}`);
  return { studios: parsedStudios, tools: parsedTools };
}

export const registry = validateRegistry(studioDefinitions, toolDefinitions);
export const navigation = studioDefinitions.map(({ id, name, icon }) => ({ id, label: name, icon }));

export function searchTools(query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return toolDefinitions;
  return toolDefinitions.filter((tool) => {
    const studio = studioById[tool.studioId];
    return `${tool.name} ${tool.description} ${studio.name}`.toLocaleLowerCase().includes(normalized);
  });
}
