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
export type ToolStatus = "planned" | "in-development" | "available" | "unavailable";
export type ToolProcessing = "browser" | "ai" | "server-optional";
export type ToolDefinition = { id: string; name: string; studioId: StudioId; description: string; status: ToolStatus; icon: string; processing?: ToolProcessing; unavailableReason?: string };
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

export const toolDefinitions: readonly ToolDefinition[] = [
  { id: "merge-pdf", name: "Merge PDF", studioId: "pdf-essentials", description: "Combine up to 10 PDFs with page counts, thumbnails and drag-to-reorder on this device.", status: "available", icon: "Combine" },
  { id: "split-pdf", name: "Split PDF", studioId: "pdf-essentials", description: "Extract pages, split every page, use custom ranges or equal groups, and download a ZIP on this device.", status: "available", icon: "Scissors" },
  { id: "rotate-pdf", name: "Rotate PDF", studioId: "pdf-essentials", description: "Preview pages and rotate all, selected, or individual pages on this device.", status: "available", icon: "RotateCw" },
  { id: "pdf-to-office", name: "PDF to Office", studioId: "pdf-conversion", description: "Rebuild PDF text, detected tables and content pictures into editable Word or Excel. Image-only pages need OCR; Visual Word is separate, and an optional self-hosted layout engine is available when configured.", status: "available", icon: "ArrowRightLeft", processing: "server-optional" },
  { id: "edit-pdf", name: "Edit PDF", studioId: "pdf-editor", description: "Annotate a PDF, cover and replace text visually, and download a flattened copy.", status: "available", icon: "FilePenLine" },
  { id: "organize-pages", name: "Reorder PDF pages", studioId: "pdf-organizer-layout", description: "Arrange every page into a new order on this device.", status: "available", icon: "LayoutGrid" },
  { id: "delete-pdf-pages", name: "Delete PDF pages", studioId: "pdf-organizer-layout", description: "Remove selected pages from a PDF on this device.", status: "available", icon: "Trash2" },
  { id: "extract-pdf-pages", name: "Extract PDF pages", studioId: "pdf-organizer-layout", description: "Create a PDF from selected pages on this device.", status: "available", icon: "FileOutput" },
  { id: "duplicate-pdf-pages", name: "Duplicate PDF pages", studioId: "pdf-organizer-layout", description: "Append copies of selected PDF pages.", status: "available", icon: "Copy" },
  { id: "add-blank-pdf-pages", name: "Add blank PDF pages", studioId: "pdf-organizer-layout", description: "Insert blank pages that match the neighboring page size.", status: "available", icon: "FilePlus2" },
  { id: "sign-pdf", name: "Sign PDF", studioId: "pdf-security-signature", description: "Type a signature and place it on any page. A visual signature, not a certificate.", status: "available", icon: "PenTool" },
  { id: "protect-pdf", name: "Protect PDF", studioId: "pdf-security-signature", description: "Encrypt a PDF with separate opening and owner passwords using AES-256.", status: "available", icon: "LockKeyhole" },
  { id: "redact-pdf", name: "Redact PDF", studioId: "pdf-security-signature", description: "Draw boxes over sensitive areas and burn them into the page permanently.", status: "available", icon: "ShieldAlert" },
  { id: "unlock-pdf", name: "Unlock PDF", studioId: "pdf-security-signature", description: "Open a locked PDF with your password and save a copy that needs none.", status: "available", icon: "LockKeyholeOpen" },
  { id: "compress-pdf", name: "Compress PDF", studioId: "pdf-repair-optimization", description: "Rewrite PDF structure and report the measured size change.", status: "available", icon: "Minimize2" },
  { id: "repair-pdf", name: "Repair PDF", studioId: "pdf-repair-optimization", description: "Rebuild damaged PDF structure and recover every readable page.", status: "available", icon: "Wrench" },
  { id: "optimize-pdf", name: "Optimize PDF", studioId: "pdf-repair-optimization", description: "Rewrite PDF structure with optional clean-ups and a measured size report.", status: "available", icon: "Sparkles" },
  { id: "pdf-to-images", name: "PDF to Images", studioId: "pdf-conversion", description: "Render all or selected PDF pages as validated PNG or JPG at 72-300 DPI, with previews and ZIP download.", status: "available", icon: "Images" },
  { id: "pdf-to-text", name: "PDF to Text", studioId: "pdf-conversion", description: "Extract selectable PDF text into UTF-8 plain text with page ranges, previews, batch conversion and empty-page reporting.", status: "available", icon: "FileOutput" },
  { id: "pdf-to-html", name: "PDF to HTML", studioId: "pdf-conversion", description: "Turn a PDF into safe reading or approximate layout HTML, with pictures and tables, plus a complete ZIP package.", status: "available", icon: "FileOutput" },
  { id: "images-to-pdf", name: "Images to PDF", studioId: "pdf-conversion", description: "Combine JPG and PNG images into a PDF with reordering, A3-A5/Letter/Legal/custom pages, margins, fitting and compression.", status: "available", icon: "FileImage" },
  { id: "pdf-watermark", name: "PDF Watermark", studioId: "pdf-essentials", description: "Add a text or image watermark with live preview, colour and scale controls.", status: "available", icon: "Stamp" },
  { id: "pdf-page-numbers", name: "PDF Page Numbers", studioId: "pdf-essentials", description: "Add page numbers with position, colour, format, margins and skip-cover controls.", status: "available", icon: "ListOrdered" },
  { id: "image-converter", name: "Image converter", studioId: "image-studio", description: "Convert and resize common image formats in the browser.", status: "available", icon: "ImagePlus" },
  { id: "ocr-image", name: "Image OCR", studioId: "ocr-scanning-studio", description: "Extract text from a scanned image in your browser.", status: "available", icon: "ScanText" },
  { id: "ocr-pdf", name: "OCR PDF", studioId: "ocr-scanning-studio", description: "Recognize text in scanned PDF pages and download a searchable PDF or plain text.", status: "available", icon: "ScanLine" },
  { id: "document-editor", name: "Document editor", studioId: "document-studio", description: "Write, import and format rich-text documents in the browser, then export PDF.", status: "available", icon: "FileText" },
  { id: "document-to-pdf", name: "Document to PDF", studioId: "document-studio", description: "Turn a Word, text or Markdown document into a PDF. An optional server engine keeps the original layout.", status: "available", icon: "FileOutput", processing: "server-optional" },
  { id: "spreadsheet-editor", name: "Spreadsheet Editor", studioId: "spreadsheet-studio", description: "Build a sheet with formulas and export it as CSV, on this device.", status: "available", icon: "Sheet" },
  { id: "presentation-editor", name: "Presentation Editor", studioId: "presentation-studio", description: "Build, present and export a slide deck as PDF, on this device.", status: "available", icon: "Presentation" },
  { id: "spreadsheet-to-pdf", name: "Spreadsheet to PDF", studioId: "spreadsheet-studio", description: "Print an Excel or CSV file as a paginated PDF.", status: "available", icon: "Sheet" },
  { id: "presentation-to-pdf", name: "Presentation to PDF", studioId: "presentation-studio", description: "Export slides as a text-faithful PDF.", status: "available", icon: "Presentation" },
  { id: "ai-assistant", name: "AI assistant", studioId: "ai-studio", description: "Summarize, rewrite or explain text with Sarvam 105B (server-configured).", status: "available", icon: "WandSparkles", processing: "ai" },
  { id: "document-summary", name: "Document summary", studioId: "ai-studio", description: "Summarize a PDF, Word or text file with Sarvam 105B.", status: "available", icon: "ListChecks", processing: "ai" },
  { id: "ai-document-agent", name: "AI document agent", studioId: "ai-studio", description: "Turn a PDF or Word file into a new Word document that follows your instructions.", status: "available", icon: "Bot", processing: "ai" },
  { id: "universal-converter", name: "Convert anything", studioId: "ai-studio", description: "Name the format you want and APOS picks the right converter for the file.", status: "available", icon: "Repeat2" },
  { id: "workflow-builder", name: "Workflow builder", studioId: "automation-studio", description: "Design a sequence of PDF steps and run it on your own files in the browser.", status: "available", icon: "Workflow" },
  { id: "file-inspector", name: "File inspector", studioId: "utility-studio", description: "Review basic properties of a document file.", status: "available", icon: "ScanSearch" },
  { id: "document-passport", name: "Document Passport", studioId: "utility-studio", description: "Fingerprint a document, reveal metadata, attachments, forms, hidden objects and sharing risks, then create a clean PDF copy.", status: "available", icon: "Fingerprint" },
  { id: "pdf-metadata", name: "PDF metadata", studioId: "developer-studio", description: "Inspect and edit supported standard PDF document-information fields.", status: "available", icon: "Braces" }
];

const studioSchema = z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string().min(1), icon: z.string().min(1), accent: z.string().min(1) }).strict();
const statusSchema = z.enum(["planned", "in-development", "available", "unavailable"]);
const processingSchema = z.enum(["browser", "ai", "server-optional"]);
const toolSchema = z.object({ id: z.string().min(1), name: z.string().min(1), studioId: z.string().min(1), description: z.string().min(1), status: statusSchema, icon: z.string().min(1), processing: processingSchema.optional(), unavailableReason: z.string().min(1).optional() }).strict().superRefine((tool, ctx) => {
  if (tool.status === "unavailable" && !tool.unavailableReason) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unavailableReason"], message: "Unavailable tools need an explanation." });
});

export function processingMode(tool: Pick<ToolDefinition, "processing">): ToolProcessing {
  return tool.processing ?? "browser";
}

export function processingSummary(tool: Pick<ToolDefinition, "processing">): string {
  const mode = processingMode(tool);
  if (mode === "ai") return "Reads the file in your browser and sends only the extracted text to the configured AI service.";
  if (mode === "server-optional") return "Runs in your browser by default; an explicitly selected server mode uploads the document to your configured processing server.";
  return "Runs entirely in this browser; the file is not uploaded.";
}

export function processingDisclosure(tool: Pick<ToolDefinition, "processing">): string {
  const mode = processingMode(tool);
  if (mode === "ai") return "It is free to use and needs no account. Files are read inside your browser; only the text you choose to process — typed text or text extracted from a file — is sent to the configured Sarvam 105B service. The API key never reaches your browser.";
  if (mode === "server-optional") return "It is free to use and needs no account. Browser mode processes the document on this device. If you explicitly select the optional server mode, the document is uploaded to the configured APOS processing server instead.";
  return "It is free to use, needs no account, and runs entirely inside your browser, so the document never leaves your device.";
}

export function processingSteps(tool: Pick<ToolDefinition, "processing">): { title: string; copy: string }[] {
  const mode = processingMode(tool);
  if (mode === "ai") return [
    { title: "Choose a file or paste text", copy: "Files are read on this device; only the text you choose to process is sent for AI processing." },
    { title: "Run the tool", copy: "The AI request uses the server-configured Sarvam endpoint, with live progress." },
    { title: "Keep the result", copy: "Download the finished file; a source file is never uploaded." },
  ];
  if (mode === "server-optional") return [
    { title: "Choose a file", copy: "Browser mode keeps it on this device. Server mode uploads it to your configured processing server." },
    { title: "Pick an engine", copy: "The browser engine is the default; choose the server engine explicitly when you need native layout fidelity." },
    { title: "Keep the result", copy: "Download the finished file and carry on." },
  ];
  return [
    { title: "Choose a file", copy: "It stays on this device — nothing is uploaded." },
    { title: "Run the tool", copy: "Processing happens in your browser, with live progress." },
    { title: "Keep the result", copy: "Download the finished file and carry on." },
  ];
}

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
