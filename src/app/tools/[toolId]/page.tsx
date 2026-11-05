import Link from "next/link";
import { notFound } from "next/navigation";
import { toolDefinitions, studioById } from "@/lib/registry";
import RouteHeader from "@/components/route-header";
import ToolRenderer from "@/components/tool-renderer";

export function generateStaticParams() { return toolDefinitions.map(({ id }) => ({ toolId: id })); }

export default async function ToolPage({ params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const tool = toolDefinitions.find((item) => item.id === toolId);
  if (!tool) notFound();
  const studio = studioById[tool.studioId];
  return <><RouteHeader title={tool.name}/><main className="content-wrap route-content">
    <Link className="text-link" href={`/studios/${studio.id}`}><span aria-hidden="true">{"\u2190"}</span> {studio.name}</Link>
    <div className="eyebrow">{studio.name.toUpperCase()}</div><h1>{tool.name}</h1><p className="welcome-copy">{tool.description}</p>
    <ToolRenderer toolId={tool.id} status={tool.status} />
  </main></>;
}
