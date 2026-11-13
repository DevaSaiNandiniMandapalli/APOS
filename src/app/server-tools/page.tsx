import type { Metadata } from "next";
import { Server } from "lucide-react";
import RouteHeader from "@/components/route-header";
import Breadcrumbs from "@/components/breadcrumbs";
import SiteFooter from "@/components/site-footer";
import ServerToolsConsole from "@/components/server-tools-console";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Server tools",
  description:
    "Connect APOS to an optional self-hosted FastAPI processing server for LibreOffice, Ghostscript, OCR, PAdES signing, PDF/A, Office conversion and advanced PDF analysis.",
  alternates: { canonical: `${SITE.url}/server-tools` },
};

export default function ServerToolsPage() {
  return <>
    <RouteHeader title="Server tools" section={{ name: "Processing server", path: "/server-tools" }} />
    <main id="main-content" className="content-wrap route-content">
      <div className="ambient" aria-hidden="true"><i /><i /><i /></div>
      <Breadcrumbs items={[{ name: "Directory", path: "/studios" }]} current="Server tools" />
      <header className="route-hero">
        <span className="route-hero-icon"><Server size={24} /><span className="hero-ring" /></span>
        <div className="route-hero-copy">
          <div className="eyebrow">Optional self-hosted engine</div>
          <h1 className="hero-title">Server tools</h1>
          <p className="welcome-copy">Native document engines for conversions and security operations that cannot run fully in a browser. Browser-local tools remain the default and never upload your files.</p>
        </div>
        <span className="status-pill status-available"><i /> Separate service</span>
      </header>
      <section className="answer-box" aria-labelledby="server-tools-answer">
        <h2 id="server-tools-answer">How APOS server processing works</h2>
        <p>The APOS FastAPI service exposes the processing code supplied for this project. When it is configured, tools that need LibreOffice, Ghostscript, WeasyPrint, pyHanko, pdf2docx, pdfplumber or OCRmyPDF become usable from this page. Without a configured server, nothing here pretends to work, and every browser-local tool continues to operate normally.</p>
      </section>
      <div className="tool-panel moving-border"><ServerToolsConsole /></div>
      <SiteFooter excludeStudio="PDF Conversion" />
    </main>
  </>;
}
