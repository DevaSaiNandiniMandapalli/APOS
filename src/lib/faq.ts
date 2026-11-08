import { studioDefinitions, toolDefinitions } from "@/lib/registry";
import type { Faq } from "@/lib/seo";

const ready = toolDefinitions.filter((tool) => tool.status === "available");

export const siteFaqs: Faq[] = [
  {
    question: "What is APOS?",
    answer: `APOS is a private document workspace for the browser. It holds ${toolDefinitions.length} PDF and Office tools across ${studioDefinitions.length} studios — merging, splitting, compressing, repairing, optimising, OCR, converting between PDF and Office formats, protecting and drafting documents — with ${ready.length} usable today.`,
  },
  {
    question: "Are my files uploaded to a server?",
    answer:
      "No. Document tools run inside your browser using WebAssembly and web workers, so files are read from your disk and written back to your disk without an upload. The only data that leaves your device is text you explicitly send to the optional AI writing features.",
  },
  {
    question: "Is APOS free?",
    answer: `Yes. Every available tool is free with no account, no watermark and no per-file limit. ${toolDefinitions.length - ready.length} tools are not finished yet and are labelled Planned or In Development instead of being hidden.`,
  },
  {
    question: "Which tools work today?",
    answer: `Today's working set covers merging, splitting, rotating, reordering, deleting, extracting and duplicating PDF pages, adding blank pages, compressing, repairing, optimising, protecting with AES-256, OCR, PDF to Word or Excel, images to PDF, PDF to images, PDF to text, metadata editing, spreadsheet and presentation to PDF, the document editor, the AI assistant, the AI document agent, the universal converter, the workflow builder and the file inspector.`,
  },
  {
    question: "What are the file size limits?",
    answer:
      "50 MB per file. Because processing happens in your browser the real ceiling is your device's memory, so very large scans may be refused before work starts. Rejected files never leave your device.",
  },
  {
    question: "Does APOS convert PDF to Word or Excel and back?",
    answer:
      "Yes. PDF to Office extracts the text and rebuilds a real .docx or .xlsx file, and Word, Excel and PowerPoint files can be converted to PDF. Text and simple structure survive the trip; complex layouts, embedded fonts and vector graphics are not reproduced exactly, and APOS states that rather than pretending otherwise.",
  },
  {
    question: "Which AI model powers the writing features?",
    answer:
      "Sarvam 105B, reached through Sarvam's chat completions API. The assistant, document summariser and AI document agent use it; every other tool is deterministic and does not involve a model at all.",
  },
  {
    question: "Can APOS repair a damaged PDF?",
    answer:
      "It can rebuild broken structure: a missing cross-reference table, a bad startxref pointer, a truncated trailer or a damaged page tree. Readable pages are recovered and the output is validated before download. Content that was never written to the file cannot be invented.",
  },
  {
    question: "Does APOS work offline or on a phone?",
    answer:
      "Tool pages load once and then run locally, so processing works on a weak connection. The interface is responsive, so the same tools work in mobile browsers, subject to the phone's memory. AI features need a connection.",
  },
  {
    question: "How is APOS different from other PDF sites?",
    answer:
      "Three things: processing happens on your device rather than on someone else's server, unfinished tools are labelled honestly instead of faked, and reports are measured — compression, repair and optimisation all show real byte counts and page counts, verified by re-opening the output before you download it.",
  },
];
