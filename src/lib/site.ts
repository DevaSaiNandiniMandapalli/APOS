export const SITE = {
  name: "APOS",
  legalName: "APOS Document Workspace",
  url: (process.env.NEXT_PUBLIC_SITE_URL || "https://apos.nxtgensec.org").replace(/\/$/, ""),
  tagline: "Private, browser-based PDF and office tools",
  description:
    "APOS is a private document workspace with PDF and Office tools: merge, split, compress, repair, optimise, OCR, convert PDF to Word or Excel, sign, protect and draft documents with AI. Core tools process on your device; AI features and optional server modes are clearly disclosed.",
  shortDescription: "Private, browser-first PDF and Office tools.",
  locale: "en_US",
  language: "en",
  themeColor: "#d42924",
  backgroundColor: "#f7f8fa",
  twitter: "@apos",
  keywords: [
    "PDF tools",
    "merge PDF",
    "split PDF",
    "compress PDF",
    "repair PDF",
    "OCR PDF",
    "PDF to Word",
    "Word to PDF",
    "Excel to PDF",
    "presentation to PDF",
    "document editor",
    "private PDF tools",
    "offline PDF converter",
    "AI document assistant",
  ],
} as const;

export function absoluteUrl(path = "/"): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE.url}${path.startsWith("/") ? path : `/${path}`}`;
}
