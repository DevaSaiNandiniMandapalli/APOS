import { createElement } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { studioDefinitions, toolDefinitions } from "@/lib/registry";
import { iconFor } from "@/lib/icons";
import RouteHeader from "@/components/route-header";
import Breadcrumbs from "@/components/breadcrumbs";
import SiteFooter from "@/components/site-footer";
import StructuredData from "@/components/structured-data";
import { breadcrumbSchema, studioMetadata, studioSchema } from "@/lib/seo";

export function generateStaticParams() { return studioDefinitions.map(({ id }) => ({ studioId: id })); }

export async function generateMetadata({ params }: { params: Promise<{ studioId: string }> }): Promise<Metadata> {
  const { studioId } = await params;
  const studio = studioDefinitions.find((item) => item.id === studioId);
  if (!studio) return { title: "Studio not found" };
  return studioMetadata(studio, toolDefinitions.filter((tool) => tool.studioId === studio.id));
}

export default async function StudioPage({ params }: { params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  const studio = studioDefinitions.find((item) => item.id === studioId);
  if (!studio) notFound();
  const tools = toolDefinitions.filter((tool) => tool.studioId === studio.id);
  const available = tools.filter((tool) => tool.status === "available").length;
  const others = studioDefinitions.filter((item) => item.id !== studio.id).slice(0, 4);

  return <>
    <StructuredData data={[
      studioSchema(studio, tools),
      breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Studios", path: "/studios" }, { name: studio.name, path: `/studios/${studio.id}` }]),
    ]} />
    <RouteHeader title={studio.name} section={{ name: "Studios", path: "/studios" }} />
    <main id="main-content" className="content-wrap route-content">
      <div className="ambient" aria-hidden="true"><i /><i /><i /></div>
      <Breadcrumbs items={[{ name: "Studios", path: "/studios" }]} current={studio.name} />
      <header className="route-hero">
        <span className="route-hero-icon">{createElement(iconFor(studio.icon), { size: 24 })}<span className="hero-ring" /></span>
        <div className="route-hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> STUDIO</div>
          <h1>{studio.name}</h1>
          <p className="welcome-copy">{studio.description}</p>
        </div>
        <span className="route-hero-badge"><b>{available}</b> of {tools.length} ready</span>
      </header>

      <section className="answer-box" aria-labelledby="studio-answer">
        <h2 id="studio-answer">What this studio is for</h2>
        <p>
          {studio.description} {available} of the {tools.length} tools here work today, each running locally in your
          browser with no upload{available < tools.length ? "; the remaining tools are clearly marked as planned or in development" : ""}.
        </p>
      </section>

      <section className="tools-section"><div className="section-heading"><div><div className="section-eyebrow">TOOLS IN THIS STUDIO</div><h2>Available and planned work</h2></div></div>
        <div className="tool-grid">{tools.map((tool, index) => {
          const label = tool.status === "in-development" ? "In Development" : tool.status[0].toUpperCase() + tool.status.slice(1);
          return <Link className={`tool-card tool-link moving-border accent-${studio.accent}`} key={tool.id} href={`/tools/${tool.id}`}>
            <div className="tool-card-head"><span className="tool-icon">{createElement(iconFor(tool.icon), { size: 18 })}</span><span className="tool-index">{String(index + 1).padStart(2, "0")}</span></div>
            <h2>{tool.name}</h2><p>{tool.description}</p>
            <span className={`status-pill status-${tool.status}`}><i /> {label}</span>
          </Link>;
        })}</div>
      </section>

      <section className="related-block" aria-labelledby="other-studios">
        <div className="section-eyebrow">KEEP EXPLORING</div>
        <h2 id="other-studios">Other studios</h2>
        <ul className="related-list">
          {others.map((item) => {
            const count = toolDefinitions.filter((tool) => tool.studioId === item.id && tool.status === "available").length;
            return <li key={item.id}><Link href={`/studios/${item.id}`}>
              <span className="related-icon">{createElement(iconFor(item.icon), { size: 16 })}</span>
              <span><strong>{item.name}</strong><em>{count} tools ready · {item.description}</em></span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link></li>;
          })}
        </ul>
      </section>
      <p className="route-note">Planned tools are not yet available for processing. No file upload is offered on this page.</p>
      <SiteFooter excludeStudio={studio.name} />
    </main>
  </>;
}
