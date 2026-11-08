import Link from "next/link";
import { studioDefinitions, toolDefinitions } from "@/lib/registry";

const FEATURED = ["merge-pdf", "split-pdf", "compress-pdf", "repair-pdf", "optimize-pdf", "pdf-to-office", "ocr-pdf", "ai-document-agent"];

export default function SiteFooter({ excludeStudio, excludeTool }: { excludeStudio?: string; excludeTool?: string } = {}) {
  const tools = FEATURED.filter((id) => id !== excludeTool).map((id) => toolDefinitions.find((tool) => tool.id === id)).filter(Boolean);
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div className="site-footer-brand">
          <Link className="footer-brand" href="/">
            <span className="brand-mark small"><span /><span /><span /><span /></span> apos<span className="brand-dot">.</span>
          </Link>
          <p>Private document work:{" "}
            {toolDefinitions.filter((tool) => tool.status === "available").length} working tools, thirty-nine in all,
            each running inside your browser.
          </p>
        </div>
        <nav className="site-footer-col" aria-label="Popular tools">
          <h2>Popular tools</h2>
          <div className="site-footer-links">
            {tools.map((tool) => (
              <div key={tool!.id}><Link href={`/tools/${tool!.id}`}>{tool!.name}</Link></div>
            ))}
          </div>
        </nav>
        <nav className="site-footer-col" aria-label="Studios">
          <h2>Studios</h2>
          <div className="site-footer-links">
            {studioDefinitions.filter((studio) => studio.name !== excludeStudio).map((studio) => (
              <div key={studio.id}><Link href={`/studios/${studio.id}`}>{studio.name}</Link></div>
            ))}
          </div>
        </nav>
        <nav className="site-footer-col" aria-label="Resources">
          <h2>Explore</h2>
          <div className="site-footer-links">
            <div><Link href="/studios">All studios</Link></div>
            <div><Link href="/faq">Questions &amp; answers</Link></div>
            <div><Link href="/llms.txt">llms.txt for AI assistants</Link></div>
            <div><Link href="/sitemap.xml">Sitemap</Link></div>
          </div>
        </nav>
      </div>
      <div className="site-footer-base">
        <span>© 2026 APOS</span>
        <span className="site-footer-note">Files stay on your device · No accounts · No tracking scripts</span>
      </div>
    </footer>
  );
}
