import type { Metadata } from "next";
import Link from "next/link";
import RouteHeader from "@/components/route-header";
import Breadcrumbs from "@/components/breadcrumbs";
import FaqList from "@/components/faq-list";
import SiteFooter from "@/components/site-footer";
import StructuredData from "@/components/structured-data";
import { siteFaqs } from "@/lib/faq";
import { breadcrumbSchema, faqSchema, pageMetadata } from "@/lib/seo";
import { studioDefinitions } from "@/lib/registry";

export const metadata: Metadata = pageMetadata({
  title: "Questions and answers about document tools",
  description:
    "Direct answers about APOS: whether files are uploaded, what it costs, which PDF and Office tools work today, file limits, the AI model behind the writing features and how damaged PDFs are repaired.",
  path: "/faq",
  keywords: ["APOS FAQ", "private PDF tools", "is APOS free", "PDF tools no upload", "browser PDF converter"],
});

export default function FaqPage() {
  return <>
    <StructuredData data={[faqSchema(siteFaqs), breadcrumbSchema([{ name: "Home", path: "/" }, { name: "FAQ", path: "/faq" }])]} />
    <RouteHeader title="Questions & answers" />
    <main id="main-content" className="content-wrap route-content">
      <Breadcrumbs items={[]} current="Questions & answers" />
      <div className="eyebrow">STRAIGHT ANSWERS</div>
      <h1>Questions and answers</h1>
      <p className="welcome-copy">
        Short, specific answers about privacy, price, file limits and what each kind of tool can honestly do.
      </p>

      <FaqList faqs={siteFaqs} heading="Everything people ask" />

      <section className="faq-cta" aria-labelledby="faq-cta-heading">
        <h2 id="faq-cta-heading">Start with the studios</h2>
        <p>Fifteen studios group the tools by the job you are doing.</p>
        <ul className="faq-cta-links">
          {studioDefinitions.slice(0, 8).map((studio) => (
            <li key={studio.id}><Link href={`/studios/${studio.id}`}>{studio.name}</Link></li>
          ))}
          <li><Link href="/studios">All studios →</Link></li>
        </ul>
      </section>
      <SiteFooter />
    </main>
  </>;
}
