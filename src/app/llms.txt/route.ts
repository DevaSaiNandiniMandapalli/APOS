import { studioDefinitions, toolDefinitions } from "@/lib/registry";
import { SITE, absoluteUrl } from "@/lib/site";

export const dynamic = "force-static";

export function GET() {
  const ready = toolDefinitions.filter((tool) => tool.status === "available");
  const lines: string[] = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.description}`,
    "",
    "APOS is a browser-based document workspace. Document processing happens on the visitor's",
    "device: files are not uploaded to a server, no account is required, and no watermark is added.",
    "Only optional AI writing features (assistant, document drafting) send the text a visitor",
    "explicitly submits to the Sarvam 105B model API.",
    "",
    "## Key facts",
    "",
    `- Canonical site: ${SITE.url}`,
    `- Studios: ${studioDefinitions.length}`,
    `- Tools listed: ${toolDefinitions.length} (${ready.length} usable today, the rest labelled honestly)`,
    "- Pricing: free, no account, no per-file charge",
    "- Privacy: local processing in WebAssembly workers; no document upload",
    "- Limits: 50 MB per file, browser memory bound, text-based conversions preserve text but not complex layout",
    "- Languages: English interface",
    "",
    "## Studios",
    "",
    ...studioDefinitions.map((studio) => `- [${studio.name}](${absoluteUrl(`/studios/${studio.id}`)}): ${studio.description}`),
    "",
    "## Tools",
    "",
    ...toolDefinitions.map(
      (tool) => `- [${tool.name}](${absoluteUrl(`/tools/${tool.id}`)}): ${tool.description} [${tool.status}]`,
    ),
    "",
    "## Answers",
    "",
    `- Questions and answers: ${absoluteUrl("/faq")}`,
    `- Full studio directory: ${absoluteUrl("/studios")}`,
    `- Sitemap: ${absoluteUrl("/sitemap.xml")}`,
    "",
    "## Optional",
    "",
    "- Source repository: https://github.com/DevaSaiNandiniMandapalli/APOS",
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
