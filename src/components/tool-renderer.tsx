"use client";

import { Component, type ReactNode } from "react";
import dynamic from "next/dynamic";

const loading = () => <p className="privacy-note">Loading tool…</p>;

// Each tool is code-split: its chunk (and any failure) is isolated to its own route.
const MergePdf = dynamic(() => import("@/components/merge-pdf"), { ssr: false, loading });
const SplitPdf = dynamic(() => import("@/components/split-pdf"), { ssr: false, loading });
const RotatePdf = dynamic(() => import("@/components/rotate-pdf"), { ssr: false, loading });
const OrganizePdf = dynamic(() => import("@/components/organize-pdf"), { ssr: false, loading });
const CompressPdf = dynamic(() => import("@/components/compress-pdf"), { ssr: false, loading });
const PdfToImages = dynamic(() => import("@/components/pdf-to-images"), { ssr: false, loading });
const ImagesToPdf = dynamic(() => import("@/components/images-to-pdf"), { ssr: false, loading });
const PdfMarking = dynamic(() => import("@/components/pdf-marking"), { ssr: false, loading });
const PdfMetadataTool = dynamic(() => import("@/components/pdf-metadata"), { ssr: false, loading });
const ProtectPdf = dynamic(() => import("@/components/protect-pdf"), { ssr: false, loading });
const PdfToText = dynamic(() => import("@/components/pdf-to-text"), { ssr: false, loading });
const ImageConverter = dynamic(() => import("@/components/image-converter"), { ssr: false, loading });
const PdfViewer = dynamic(() => import("@/components/pdf-viewer"), { ssr: false, loading });
const DocumentEditor = dynamic(() => import("@/components/document-editor"), { ssr: false, loading });
const SpreadsheetStudio = dynamic(() => import("@/components/spreadsheet-studio"), { ssr: false, loading });
const PresentationStudio = dynamic(() => import("@/components/presentation-studio"), { ssr: false, loading });
const AiAssistant = dynamic(() => import("@/components/ai-assistant"), { ssr: false, loading });
const OcrTool = dynamic(() => import("@/components/ocr-tool"), { ssr: false, loading });
const WorkflowBuilder = dynamic(() => import("@/components/workflow-builder"), { ssr: false, loading });
const FileInspector = dynamic(() => import("@/components/file-inspector"), { ssr: false, loading });
const DocumentSummary = dynamic(() => import("@/components/document-summary"), { ssr: false, loading });
const OcrPdf = dynamic(() => import("@/components/ocr-pdf"), { ssr: false, loading });
const OfficeConvert = dynamic(() => import("@/components/office-convert"), { ssr: false, loading });
const AiDocumentAgent = dynamic(() => import("@/components/ai-document-agent"), { ssr: false, loading });

type ToolEntry = { pill?: string; render: () => ReactNode };

const TOOLS: Record<string, ToolEntry> = {
  "merge-pdf": { render: () => <MergePdf /> },
  "split-pdf": { pill: "Available · processed on this device", render: () => <SplitPdf /> },
  "rotate-pdf": { pill: "Available · processed on this device", render: () => <RotatePdf /> },
  "compress-pdf": { pill: "Available · structural rewrite on this device", render: () => <CompressPdf /> },
  "pdf-to-images": { pill: "Available · processed on this device", render: () => <PdfToImages /> },
  "pdf-to-text": { pill: "Available · browser-local batch conversion", render: () => <PdfToText /> },
  "pdf-to-html": { pill: "Available · semantic text extraction on this device", render: () => <PdfToText outputFormat="html" /> },
  "images-to-pdf": { pill: "Available · processed on this device", render: () => <ImagesToPdf /> },
  "pdf-watermark": { pill: "Available · processed on this device", render: () => <PdfMarking operation="watermark" /> },
  "pdf-page-numbers": { pill: "Available · processed on this device", render: () => <PdfMarking operation="page-number" /> },
  "pdf-metadata": { pill: "Available · processed on this device", render: () => <PdfMetadataTool /> },
  "protect-pdf": { pill: "Available · AES-256 encryption on this device", render: () => <ProtectPdf /> },
  "organize-pages": { pill: "Available · processed on this device", render: () => <OrganizePdf operation="reorder" /> },
  "delete-pdf-pages": { pill: "Available · processed on this device", render: () => <OrganizePdf operation="delete" /> },
  "extract-pdf-pages": { pill: "Available · processed on this device", render: () => <OrganizePdf operation="extract" /> },
  "duplicate-pdf-pages": { pill: "Available · processed on this device", render: () => <OrganizePdf operation="duplicate" /> },
  "add-blank-pdf-pages": { pill: "Available · processed on this device", render: () => <OrganizePdf operation="add-blank" /> },
  "image-converter": { pill: "In Development · browser-local image conversion", render: () => <ImageConverter /> },
  "edit-pdf": { pill: "In Development · PDF viewer", render: () => <PdfViewer /> },
  "document-editor": { pill: "In Development · browser-local rich-text editor", render: () => <DocumentEditor /> },
  "spreadsheet-editor": { pill: "Available · browser-local formulas and CSV", render: () => <SpreadsheetStudio /> },
  "presentation-editor": { pill: "Available · browser-local slides and PDF export", render: () => <PresentationStudio /> },
  "ai-assistant": { pill: "Available · server-configured Sarvam 105B", render: () => <AiAssistant /> },
  "ocr-image": { pill: "Available · browser-local OCR", render: () => <OcrTool /> },
  "workflow-builder": { pill: "Available · browser-local workflow design", render: () => <WorkflowBuilder /> },
  "file-inspector": { pill: "Available · browser-local file analysis", render: () => <FileInspector /> },
  "document-summary": { pill: "Available · Sarvam 105B document summary", render: () => <DocumentSummary /> },
  "ocr-pdf": { pill: "Available · browser-local OCR for scanned PDFs", render: () => <OcrPdf /> },
  "pdf-to-office": { pill: "Available · text-based Word and Excel export", render: () => <OfficeConvert mode="pdf-to-office" /> },
  "document-to-pdf": { pill: "Available · reflowed PDF from Word or text", render: () => <OfficeConvert mode="document-to-pdf" /> },
  "spreadsheet-to-pdf": { pill: "Available · paginated PDF table", render: () => <OfficeConvert mode="spreadsheet-to-pdf" /> },
  "presentation-to-pdf": { pill: "Available · text-faithful slide export", render: () => <OfficeConvert mode="presentation-to-pdf" /> },
  "ai-document-agent": { pill: "Available · instruction-driven Word output", render: () => <AiDocumentAgent /> },
};

class ToolErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[APOS Tool]", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="planned-panel" role="alert">
          <h2>This tool ran into a problem</h2>
          <p>Please reload the page. Other tools are not affected.</p>
        </section>
      );
    }
    return this.props.children;
  }
}

export default function ToolRenderer({ toolId, status }: { toolId: string; status: string }) {
  const entry = TOOLS[toolId];
  if (!entry) {
    const label = status === "in-development" ? "In Development" : "Planned";
    return (
      <section className="planned-panel">
        <span className="status-pill">{label}</span>
        <h2>This tool is not ready yet</h2>
        <p>File processing is not available here. This page will be updated when the operation is implemented and verified.</p>
      </section>
    );
  }

  return (
    <ToolErrorBoundary>
      {entry.pill ? <div className="status-pill">{entry.pill}</div> : null}
      {entry.render()}
    </ToolErrorBoundary>
  );
}
