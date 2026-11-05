import Link from "next/link";
import { notFound } from "next/navigation";
import { toolDefinitions, studioById } from "@/lib/registry";
import MergePdf from "@/components/merge-pdf";
import SplitPdf from "@/components/split-pdf";
import RotatePdf from "@/components/rotate-pdf";
import OrganizePdf from "@/components/organize-pdf";
import CompressPdf from "@/components/compress-pdf";
import PdfToImages from "@/components/pdf-to-images";
import ImagesToPdf from "@/components/images-to-pdf";
import PdfMarking from "@/components/pdf-marking";
import PdfMetadataTool from "@/components/pdf-metadata";
import ProtectPdf from "@/components/protect-pdf";
import PdfToText from "@/components/pdf-to-text";
import ImageConverter from "@/components/image-converter";
import RouteHeader from "@/components/route-header";
import PdfViewer from "@/components/pdf-viewer";
import DocumentEditor from "@/components/document-editor";

export function generateStaticParams() { return toolDefinitions.map(({ id }) => ({ toolId: id })); }

export default async function ToolPage({ params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const tool = toolDefinitions.find((item) => item.id === toolId);
  if (!tool) notFound();
  const studio = studioById[tool.studioId];
  return <><RouteHeader title={tool.name}/><main className="content-wrap route-content">
    <Link className="text-link" href={`/studios/${studio.id}`}><span aria-hidden="true">{"\u2190"}</span> {studio.name}</Link>
    <div className="eyebrow">{studio.name.toUpperCase()}</div><h1>{tool.name}</h1><p className="welcome-copy">{tool.description}</p>
    {tool.id === "merge-pdf" ? <MergePdf/> : tool.id === "split-pdf" ? <><div className="status-pill">Available · processed on this device</div><SplitPdf/></> : tool.id === "rotate-pdf" ? <><div className="status-pill">Available · processed on this device</div><RotatePdf/></> : tool.id === "compress-pdf" ? <><div className="status-pill">Available · structural rewrite on this device</div><CompressPdf/></> : tool.id === "pdf-to-images" ? <><div className="status-pill">Available · processed on this device</div><PdfToImages/></> : tool.id === "pdf-to-text" ? <><div className="status-pill">Available · browser-local batch conversion</div><PdfToText/></> : tool.id === "pdf-to-html" ? <><div className="status-pill">Available · semantic text extraction on this device</div><PdfToText outputFormat="html"/></> : tool.id === "images-to-pdf" ? <><div className="status-pill">Available · processed on this device</div><ImagesToPdf/></> : tool.id === "pdf-watermark" ? <><div className="status-pill">Available · processed on this device</div><PdfMarking operation="watermark"/></> : tool.id === "pdf-page-numbers" ? <><div className="status-pill">Available · processed on this device</div><PdfMarking operation="page-number"/></> : tool.id === "pdf-metadata" ? <><div className="status-pill">Available · processed on this device</div><PdfMetadataTool/></> : tool.id === "protect-pdf" ? <><div className="status-pill">Available · AES-256 encryption on this device</div><ProtectPdf/></> : tool.id === "organize-pages" ? <><div className="status-pill">Available · processed on this device</div><OrganizePdf operation="reorder"/></> : tool.id === "delete-pdf-pages" ? <><div className="status-pill">Available · processed on this device</div><OrganizePdf operation="delete"/></> : tool.id === "extract-pdf-pages" ? <><div className="status-pill">Available · processed on this device</div><OrganizePdf operation="extract"/></> : tool.id === "duplicate-pdf-pages" ? <><div className="status-pill">Available · processed on this device</div><OrganizePdf operation="duplicate"/></> : tool.id === "add-blank-pdf-pages" ? <><div className="status-pill">Available · processed on this device</div><OrganizePdf operation="add-blank"/></> : tool.id === "image-converter" ? <><div className="status-pill">In Development · browser-local image conversion</div><ImageConverter/></> : tool.id === "edit-pdf" ? <><div className="status-pill">In Development · PDF viewer</div><PdfViewer/></> : tool.id === "document-editor" ? <><div className="status-pill">In Development · browser-local rich-text editor</div><DocumentEditor/></> : <section className="planned-panel"><span className="status-pill">{(tool.status as string) === "in-development" ? "In Development" : "Planned"}</span><h2>This tool is not ready yet</h2><p>File processing is not available here. This page will be updated when the operation is implemented and verified.</p></section>}
  </main></>;
}
