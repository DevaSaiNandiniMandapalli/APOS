import Link from "next/link";
import { notFound } from "next/navigation";
import { studioDefinitions, toolDefinitions } from "@/lib/registry";
import RouteHeader from "@/components/route-header";

export function generateStaticParams() { return studioDefinitions.map(({ id }) => ({ studioId: id })); }

export default async function StudioPage({ params }: { params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  const studio = studioDefinitions.find((item) => item.id === studioId);
  if (!studio) notFound();
  const tools = toolDefinitions.filter((tool) => tool.studioId === studio.id);
  return <><RouteHeader title={studio.name}/><main className="content-wrap route-content">
    <Link className="text-link" href="/studios">← All studios</Link>
    <div className="eyebrow">STUDIO</div><h1>{studio.name}</h1><p className="welcome-copy">{studio.description}</p>
    <section className="tools-section"><div className="section-heading"><div><div className="section-eyebrow">TOOLS IN THIS STUDIO</div><h2>Available and planned work</h2></div></div>
      <div className="tool-grid">{tools.map((tool) => <Link className="tool-card tool-link" key={tool.id} href={`/tools/${tool.id}`}>
        <h2>{tool.name}</h2><p>{tool.description}</p><span className="status-pill"><i/> {tool.status === "in-development" ? "In Development" : tool.status[0].toUpperCase() + tool.status.slice(1)}</span>
      </Link>)}</div>
    </section><p className="route-note">Planned tools are not yet available for processing. No file upload is offered on this page.</p>
  </main></>;
}
