import type { Faq } from "@/lib/seo";

export default function FaqList({ faqs, heading = "Questions people ask" }: { faqs: readonly Faq[]; heading?: string }) {
  return (
    <section className="faq-block" aria-labelledby="faq-heading">
      <div className="section-eyebrow">QUICK ANSWERS</div>
      <h2 id="faq-heading">{heading}</h2>
      <div className="faq-list">
        {faqs.map((faq) => (
          <details key={faq.question} className="faq-item">
            <summary>
              <h3>{faq.question}</h3>
              <span className="faq-plus" aria-hidden="true" />
            </summary>
            <p>{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
