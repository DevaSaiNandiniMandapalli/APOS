import type { Metadata } from "next";
import { SITE, absoluteUrl } from "@/lib/site";

type Studio = { id: string; name: string; description: string };
type Tool = { id: string; name: string; description: string; studioId: string; status: string };

export type Faq = { question: string; answer: string };

const OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: `${SITE.name} — ${SITE.tagline}` };

export function pageMetadata(options: {
  title: string;
  description: string;
  path: string;
  keywords?: readonly string[];
  type?: "website" | "article";
  noIndex?: boolean;
  absoluteTitle?: boolean;
}): Metadata {
  const url = absoluteUrl(options.path);
  const title = options.absoluteTitle ? `${options.title} · ${SITE.name}` : options.title;
  return {
    title,
    description: options.description,
    keywords: options.keywords ? [...options.keywords] : undefined,
    alternates: { canonical: url },
    robots: options.noIndex
      ? { index: false, follow: true }
      : { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
    openGraph: {
      type: options.type ?? "website",
      url,
      title,
      description: options.description,
      siteName: SITE.name,
      locale: SITE.locale,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: options.description,
      images: [OG_IMAGE.url],
    },
  };
}

function statusLabel(status: string): string {
  if (status === "available") return "ready to use";
  if (status === "in-development") return "in development";
  if (status === "unavailable") return "not available";
  return "planned";
}

export function toolMetadata(tool: Tool, studio: Studio): Metadata {
  const title = `${tool.name} — free ${studio.name.replace(/ Studio$/, "")} tool`;
  const description = `${tool.description} Runs privately in your browser${tool.status === "available" ? " and works today" : `; currently ${statusLabel(tool.status)}`}. No upload, no account, no APOS-added watermark.`;
  return pageMetadata({
    title,
    description: description.slice(0, 300),
    path: `/tools/${tool.id}`,
    keywords: [tool.name, `${tool.name} online`, `${tool.name} free`, `${studio.name}`, ...SITE.keywords.slice(0, 5)],
  });
}

export function studioMetadata(studio: Studio, tools: readonly Tool[]): Metadata {
  const ready = tools.filter((tool) => tool.status === "available").length;
  return pageMetadata({
    title: `${studio.name} — ${ready} working tools`,
    description: `${studio.description} ${ready} of ${tools.length} tools work today, each running locally in your browser with no file upload.`,
    path: `/studios/${studio.id}`,
    keywords: [studio.name, ...tools.slice(0, 6).map((tool) => tool.name), ...SITE.keywords.slice(0, 4)],
  });
}

export function toolFaqs(tool: Tool, studio: Studio): Faq[] {
  const ready = tool.status === "available";
  return [
    {
      question: `What does ${tool.name} do?`,
      answer: `${tool.name} ${tool.description.charAt(0).toLowerCase()}${tool.description.slice(1)} It sits in the ${studio.name} studio of APOS.`,
    },
    {
      question: `Is ${tool.name} free to use?`,
      answer: ready
        ? `Yes. ${tool.name} is free, needs no account and adds no APOS watermark. There is no per-file or per-page charge.`
        : `${tool.name} is not released yet, so nothing is charged. APOS labels unbuilt tools honestly instead of pretending they work.`,
    },
    {
      question: "Are my files uploaded to a server?",
      answer: ready
        ? `No. ${tool.name} processes the file inside your browser using local WebAssembly and worker threads, so the document never leaves your device. Only the optional AI writing features send text you explicitly submit.`
        : "When a tool ships in APOS it runs on your own device. APOS does not upload documents for processing.",
    },
    {
      question: `Which file types does ${tool.name} accept?`,
      answer: `See the upload control on this page for the accepted formats and the 50 MB per-file limit. Anything outside that is rejected before processing starts, so you never wait for a failed run.`,
    },
  ];
}

export function faqSchema(faqs: readonly Faq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
}

export function breadcrumbSchema(items: readonly { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE.url}/#organization`,
    name: SITE.name,
    legalName: SITE.legalName,
    url: SITE.url,
    description: SITE.description,
    logo: { "@type": "ImageObject", url: absoluteUrl("/icon.svg"), width: 512, height: 512 },
    sameAs: ["https://github.com/DevaSaiNandiniMandapalli/APOS"],
  };
}

export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE.url}/#website`,
    name: SITE.name,
    url: SITE.url,
    description: SITE.description,
    inLanguage: "en",
    publisher: { "@id": `${SITE.url}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${SITE.url}/studios?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

export function toolSchema(tool: Tool, studio: Studio) {
  const ready = tool.status === "available";
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: tool.name,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: studio.name,
    operatingSystem: "Any (web browser)",
    url: absoluteUrl(`/tools/${tool.id}`),
    description: tool.description,
    isAccessibleForFree: true,
    inLanguage: "en",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", availability: "https://schema.org/InStock" },
    featureList: [
      "Runs locally in the browser",
      "No account required",
      "No file upload for document processing",
      "Works on desktop and mobile browsers",
    ],
    ...(ready
      ? {}
      : { additionalProperty: { "@type": "PropertyValue", name: "Availability", value: statusLabel(tool.status) } }),
    publisher: { "@id": `${SITE.url}/#organization` },
  };
}

export function studioSchema(studio: Studio, tools: readonly Tool[]) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${studio.name} — APOS`,
    url: absoluteUrl(`/studios/${studio.id}`),
    description: studio.description,
    inLanguage: "en",
    isPartOf: { "@id": `${SITE.url}/#website` },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: tools.length,
      itemListElement: tools.map((tool, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: tool.name,
        url: absoluteUrl(`/tools/${tool.id}`),
        description: tool.description,
      })),
    },
  };
}

export function directorySchema(tools: readonly Tool[]) {
  const ready = tools.filter((tool) => tool.status === "available");
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "APOS tool directory",
    numberOfItems: tools.length,
    itemListElement: tools.map((tool, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: tool.name,
      url: absoluteUrl(`/tools/${tool.id}`),
      description: tool.description,
    })),
    about: { "@type": "Thing", name: `${ready.length} working document tools` },
  };
}
