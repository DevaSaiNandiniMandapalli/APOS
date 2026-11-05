import Link from "next/link";
import { notFound } from "next/navigation";
import { studioDefinitions, toolDefinitions } from "@/lib/registry";
import { iconFor } from "@/lib/icons";
import RouteHeader from "@/components/route-header";

export function generateStaticParams() { return studioDefinitions.map(({ id }) => ({ studioId: id })); }

export default async function StudioPage({ params }: { params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  const studio = studioDefinitions.find((item) => item.id === studioId);
  if (!studio) notFound();
  const tools = toolDefinitions.filter((tool) => tool.studioId === studio.id);
  const available = tools.filter((tool) => tool.status === "available").length;
  const StudioIcon = iconFor(studio.icon);
  return <><RouteHeader title={studio.name}/><main className="content-wrap route-content">
    <div className="ambient" aria-hidden="true"><i/><i/><i/></div>
    <Link className="text-link" href="/studios">← All studios</Link>
    <header className="route-hero">
      <span className="route-hero-icon"><StudioIcon size={24}/><span className="hero-ring"/></span>
      <div className="route-hero-copy">
        <div className="eyebrow"><span className="eyebrow-dot"/> STUDIO</div>
        <h1>{studio.name}</h1>
        <p className="welcome-copy">{studio.description}</p>
      </div>
      <span className="route-hero-badge"><b>{available}</b> of {tools.length} ready</span>
    </header>
    <section className="tools-section"><div className="section-heading"><div><div className="section-eyebrow">TOOLS IN THIS STUDIO</div><h2>Available and planned work</h2></div></div>
      <div className="tool-grid">{tools.map((tool, index) => {
        const Icon = iconFor(tool.icon);
        const label = tool.status === "in-development" ? "In Development" : tool.status[0].toUpperCase() + tool.status.slice(1);
        return <Link className={`tool-card tool-link moving-border accent-${studio.accent}`} key={tool.id} href={`/tools/${tool.id}`}>
          <div className="tool-card-head"><span className="tool-icon"><Icon size={18}/></span><span className="tool-index">{String(index + 1).padStart(2, "0")}</span></div>
          <h2>{tool.name}</h2><p>{tool.description}</p>
          <span className={`status-pill status-${tool.status}`}><i/> {label}</span>
        </Link>;
      })}</div>
    </section><p className="route-note">Planned tools are not yet available for processing. No file upload is offered on this page.</p>
  </main></>;
}
