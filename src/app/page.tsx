import type { Metadata } from "next";
import HomeExperience from "@/components/home-experience";
import StructuredData from "@/components/structured-data";
import { faqSchema, pageMetadata } from "@/lib/seo";
import { siteFaqs } from "@/lib/faq";
import { toolDefinitions } from "@/lib/registry";

export const metadata: Metadata = pageMetadata({
  title: "Private PDF and document tools in your browser",
  description:
    "APOS is a private document workspace with 39 free PDF and Office tools — merge, split, compress, repair, optimise, OCR, convert PDF to Word or Excel, protect and sign documents, and draft text with AI. Files are processed on your device and never uploaded.",
  path: "/",
  absoluteTitle: true,
});

export default function Page() {
  return (
    <>
      <StructuredData
        data={[
          faqSchema(siteFaqs.slice(0, 5)),
          {
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "APOS",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Any (web browser)",
            browserRequirements: "Requires JavaScript and WebAssembly",
            isAccessibleForFree: true,
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            featureList: toolDefinitions.filter((tool) => tool.status === "available").map((tool) => tool.name),
          },
        ]}
      />
      <HomeExperience />
    </>
  );
}
