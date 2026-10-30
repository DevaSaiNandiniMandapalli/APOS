import Link from "next/link";
import { studioDefinitions } from "@/lib/registry";
import RouteHeader from "@/components/route-header";

export default function StudiosPage() {
  return <><RouteHeader title="All studios"/><main className="content-wrap route-content">
    <Link className="text-link" href="/">← Workspace</Link>
    <div className="eyebrow">APOS DIRECTORY</div><h1>All studios</h1>
    <p className="welcome-copy">Explore the fifteen focused workspaces. Tools show their current development status.</p>
    <section className="studio-grid route-grid" aria-label="All product studios">
      {studioDefinitions.map((studio, i) => <Link className={`studio-card accent-${studio.accent}`} key={studio.id} href={`/studios/${studio.id}`}>
        <span className="studio-number">{String(i + 1).padStart(2, "0")}</span><h2>{studio.name}</h2><p>{studio.description}</p><span className="status-pill">Open studio →</span>
      </Link>)}
    </section>
  </main></>;
}
