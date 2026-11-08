import type { Metadata } from "next";
import Link from "next/link";
import { studioDefinitions, toolDefinitions } from "@/lib/registry";
import RouteHeader from "@/components/route-header";
import Breadcrumbs from "@/components/breadcrumbs";
import SiteFooter from "@/components/site-footer";
import StructuredData from "@/components/structured-data";
import { breadcrumbSchema, directorySchema, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "All studios and tools",
  description:
    "Browse every APOS studio: PDF essentials, conversion, editor, organiser, security, repair and optimisation, images, OCR, documents, spreadsheets, presentations, AI, automation and utilities. Each tool states honestly whether it works today.",
  path: "/studios",
  keywords: ["PDF tool directory", "document tools list", "free PDF tools", "browser document tools"],
});

export default function StudiosPage() {
  const ready = toolDefinitions.filter((tool) => tool.status === "available").length;
  return <>
    <StructuredData data={[directorySchema(toolDefinitions), breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Studios", path: "/studios" }])]} />
    <RouteHeader title="All studios" />
    <main id="main-content" className="content-wrap route-content">
      <Breadcrumbs items={[]} current="All studios" />
      <h1>All studios</h1>
      <p className="welcome-copy">
        Fifteen focused studios hold {toolDefinitions.length} tools, {ready} of which work today. Every tool shows its
        current status, so nothing here pretends to be finished when it is not.
      </p>
      <section className="studio-grid route-grid" aria-label="All product studios">
        {studioDefinitions.map((studio, i) => {
          const tools = toolDefinitions.filter((tool) => tool.studioId === studio.id);
          const available = tools.filter((tool) => tool.status === "available").length;
          return <Link className={`studio-card accent-${studio.accent}`} key={studio.id} href={`/studios/${studio.id}`}>
            <span className="studio-number">{String(i + 1).padStart(2, "0")}</span><h2>{studio.name}</h2><p>{studio.description}</p>
            <span className="status-pill">{available} of {tools.length} ready →</span>
          </Link>;
        })}
      </section>
      <SiteFooter />
    </main>
  </>;
}
