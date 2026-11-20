import type { Metadata } from "next";
import { studioDefinitions, toolDefinitions } from "@/lib/registry";
import RouteHeader from "@/components/route-header";
import Breadcrumbs from "@/components/breadcrumbs";
import SiteFooter from "@/components/site-footer";
import StructuredData from "@/components/structured-data";
import ToolDirectory from "@/components/tool-directory";
import { breadcrumbSchema, directorySchema, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "All tools",
  description:
    "Browse all APOS document tools in one searchable directory. Filter by studio or processing model, and see clearly which tools run on your device, which use an AI text service, and which offer an optional server engine.",
  path: "/tools",
  keywords: ["all PDF tools", "document tool directory", "browser PDF tools", "private document tools"],
});

export default function ToolsPage() {
  const ready = toolDefinitions.filter((tool) => tool.status === "available").length;
  return <>
    <StructuredData data={[directorySchema(toolDefinitions), breadcrumbSchema([{ name: "Home", path: "/" }, { name: "All tools", path: "/tools" }])]} />
    <RouteHeader title="All tools" />
    <main id="main-content" className="content-wrap route-content tools-directory-page">
      <Breadcrumbs items={[]} current="All tools" />
      <h1>All {toolDefinitions.length} tools</h1>
      <p className="welcome-copy">
        Every APOS tool in one place. {ready} tools work today across {studioDefinitions.length} studios. Search the
        directory or filter by studio and processing model; browser-local tools never upload a document, and AI or
        optional server modes are labelled before you open them.
      </p>
      <ToolDirectory />
      <SiteFooter />
    </main>
  </>;
}
