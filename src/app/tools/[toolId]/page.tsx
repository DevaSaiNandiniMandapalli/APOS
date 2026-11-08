import { createElement } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { toolDefinitions, studioById } from "@/lib/registry";
import { iconFor } from "@/lib/icons";
import RouteHeader from "@/components/route-header";
import ToolRenderer from "@/components/tool-renderer";
import Breadcrumbs from "@/components/breadcrumbs";
import FaqList from "@/components/faq-list";
import SiteFooter from "@/components/site-footer";
import StructuredData from "@/components/structured-data";
import { breadcrumbSchema, faqSchema, toolFaqs, toolMetadata, toolSchema } from "@/lib/seo";

export function generateStaticParams() { return toolDefinitions.map(({ id }) => ({ toolId: id })); }

export async function generateMetadata({ params }: { params: Promise<{ toolId: string }> }): Promise<Metadata> {
  const { toolId } = await params;
  const tool = toolDefinitions.find((item) => item.id === toolId);
  if (!tool) return { title: "Tool not found" };
  return toolMetadata(tool, studioById[tool.studioId]);
}

const STEPS = [
  { title: "Choose a file", copy: "It stays on this device — nothing is uploaded." },
  { title: "Run the tool", copy: "Processing happens in your browser, with live progress." },
  { title: "Keep the result", copy: "Download the finished file and carry on." },
];

export default async function ToolPage({ params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const tool = toolDefinitions.find((item) => item.id === toolId);
  if (!tool) notFound();
  const studio = studioById[tool.studioId];
  const label = tool.status === "in-development" ? "In Development" : tool.status[0].toUpperCase() + tool.status.slice(1);
  const faqs = toolFaqs(tool, studio);
  const related = toolDefinitions.filter((item) => item.studioId === tool.studioId && item.id !== tool.id).slice(0, 4);
  const crumbs = [{ name: "Studios", path: "/studios" }, { name: studio.name, path: `/studios/${studio.id}` }];

  return <>
    <StructuredData data={[
      toolSchema(tool, studio),
      faqSchema(faqs),
      breadcrumbSchema([{ name: "Home", path: "/" }, ...crumbs, { name: tool.name, path: `/tools/${tool.id}` }]),
    ]} />
    <RouteHeader title={tool.name} section={{ name: studio.name, path: `/studios/${studio.id}` }} />
    <main id="main-content" className="content-wrap route-content">
      <div className="ambient" aria-hidden="true"><i /><i /><i /></div>
      <Breadcrumbs items={crumbs} current={tool.name} />
      <header className="route-hero">
        <span className="route-hero-icon">{createElement(iconFor(tool.icon), { size: 24 })}<span className="hero-ring" /></span>
        <div className="route-hero-copy">
          <div className="eyebrow">{createElement(iconFor(studio.icon), { size: 12 })} <Link className="eyebrow-link" href={`/studios/${studio.id}`}>{studio.name}</Link></div>
          <h1 className="hero-title">{tool.name}</h1>
          <p className="welcome-copy">{tool.description}</p>
        </div>
        <span className={`status-pill status-${tool.status}`}><i /> {label}</span>
      </header>

      <section className="answer-box" aria-labelledby="answer-heading">
        <h2 id="answer-heading">{tool.name} in short</h2>
        <p>
          {tool.name} lets you {tool.description.charAt(0).toLowerCase()}{tool.description.slice(1)}{" "}
          {tool.status === "available"
            ? "It is free to use, needs no account, and runs entirely inside your browser, so the document never leaves your device."
            : "This tool is not released yet, and APOS says so plainly rather than offering a button that does nothing."}
        </p>
      </section>

      <div className="tool-panel moving-border">{<ToolRenderer toolId={tool.id} status={tool.status} />}</div>
      <section className="how" aria-label="How this tool works">
        {STEPS.map((step, index) => <div className="how-step" key={step.title}>
          <span className="how-dot">{index + 1}</span>
          <div><strong>{step.title}</strong><p>{step.copy}</p></div>
        </div>)}
      </section>

      <FaqList faqs={faqs} heading={`${tool.name}: common questions`} />

      {related.length > 0 && <section className="related-block" aria-labelledby="related-heading">
        <div className="section-eyebrow">MORE IN {studio.name.toUpperCase()}</div>
        <h2 id="related-heading">Related tools</h2>
        <div className="related-list">
          {related.map((item) => <div key={item.id}>
            <Link href={`/tools/${item.id}`}>
              <span className="related-icon">{createElement(iconFor(item.icon), { size: 16 })}</span>
              <span><strong>{item.name}</strong><em>{item.description}</em></span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>)}
        </div>
      </section>}
      <SiteFooter excludeStudio={studio.name} excludeTool={tool.id} />
    </main>
  </>;
}
