import Link from "next/link";
import { notFound } from "next/navigation";
import { toolDefinitions, studioById } from "@/lib/registry";
import { iconFor } from "@/lib/icons";
import RouteHeader from "@/components/route-header";
import ToolRenderer from "@/components/tool-renderer";

export function generateStaticParams() { return toolDefinitions.map(({ id }) => ({ toolId: id })); }

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
  const ToolIcon = iconFor(tool.icon);
  const StudioIcon = iconFor(studio.icon);
  const label = tool.status === "in-development" ? "In Development" : tool.status[0].toUpperCase() + tool.status.slice(1);
  return <><RouteHeader title={tool.name}/><main className="content-wrap route-content">
    <div className="ambient" aria-hidden="true"><i/><i/><i/></div>
    <Link className="text-link" href={`/studios/${studio.id}`}><span aria-hidden="true">{"\u2190"}</span> {studio.name}</Link>
    <header className="route-hero">
      <span className="route-hero-icon"><ToolIcon size={24}/><span className="hero-ring"/></span>
      <div className="route-hero-copy">
        <div className="eyebrow"><StudioIcon size={12}/> {studio.name.toUpperCase()}</div>
        <h1 className="hero-title">{tool.name}</h1>
        <p className="welcome-copy">{tool.description}</p>
      </div>
      <span className={`status-pill status-${tool.status}`}><i/> {label}</span>
    </header>
    <div className="tool-panel moving-border">{<ToolRenderer toolId={tool.id} status={tool.status} />}</div>
    <section className="how" aria-label="How this tool works">
      {STEPS.map((step, index) => <div className="how-step" key={step.title}>
        <span className="how-dot">{index + 1}</span>
        <div><strong>{step.title}</strong><p>{step.copy}</p></div>
      </div>)}
    </section>
  </main></>;
}
