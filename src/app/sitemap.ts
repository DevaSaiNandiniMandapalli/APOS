import type { MetadataRoute } from "next";
import { studioDefinitions, toolDefinitions } from "@/lib/registry";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE.url}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE.url}/studios`, lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE.url}/faq`, lastModified, changeFrequency: "monthly", priority: 0.7 },
  ];
  const studios: MetadataRoute.Sitemap = studioDefinitions.map((studio) => ({
    url: `${SITE.url}/studios/${studio.id}`,
    lastModified,
    changeFrequency: "monthly",
    priority: 0.8,
  }));
  const tools: MetadataRoute.Sitemap = toolDefinitions.map((tool) => ({
    url: `${SITE.url}/tools/${tool.id}`,
    lastModified,
    changeFrequency: "monthly",
    priority: tool.status === "available" ? 0.7 : 0.4,
  }));
  return [...staticRoutes, ...studios, ...tools];
}
