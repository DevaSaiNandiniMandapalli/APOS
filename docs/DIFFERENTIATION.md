# APOS differentiation and feature map

Status date: 20 November 2026. Competitor pages were read directly on 19 November 2026. This is a product comparison, not a legal or trademark review.

## 1. Where APOS is genuinely different

Individual PDF operations are commodities. iLovePDF, Smallpdf, Adobe Acrobat online and PDF24 already cover most single-purpose tools. APOS should not compete on "number of buttons". Its defensible combination is:

1. **Local-first processing for heavy document work.** Merge, split, rotate, organise, repair, optimise, OCR, redact, protect, PDF-to-Office, PDF-to-images, PDF-to-text/HTML and the Office editors run in the browser with no document upload for the browser path.
2. **No account and no file-retention model** for those browser tools.
3. **A cross-format workspace, not only a PDF utility.** APOS also has a document editor, spreadsheet editor, presentation editor, universal converter and workflow builder in the same product.
4. **Measured output and verification as a product principle.** Repair, optimisation and compression report real page/byte changes; Document Passport adds a share-readiness report and a clean-copy action; Verify & Compare measures what changed between two PDFs.
5. **Honest status and capability communication.** Server-backed and AI-backed paths are now modelled explicitly instead of being described as "never uploaded".

### Table stakes that APOS already has

Merge, split, rotate, organise, delete/extract pages, compress, repair, optimise, watermark, page numbers, protect, unlock, visual sign, redact, OCR, PDF-to-Word/Excel/PowerPoint, Office-to-PDF, images-to-PDF, PDF-to-images, PDF-to-text/HTML, metadata, page ranges, batch text conversion, ZIP downloads and a workflow builder.

### What competitors have that APOS does not (or does not do fully)

| Capability | iLovePDF | Smallpdf | Adobe online | PDF24 | APOS status |
|---|---|---|---|---|---|
| PDF to Markdown | Yes | Via converter/AI | Yes (AI) | Yes | Gap |
| PDF forms (create/fill) | Yes, new | Yes | Yes | Yes | Server-only fill |
| Flatten PDF | Not a separate tool | Yes | Yes | Yes | Partial (forms only) |
| PDF/A conversion and validation | Convert | Convert | Convert | Convert + validate PDF/A and PDF/UA | Convert only; no conformance test |
| e-signature requests | iLoveSign | Sign.com | Request signatures | No | Gap |
| Compare PDF | Yes | No dedicated tool | In Acrobat | Yes | **Local Verify & Compare** |
| AI chat/summarise/translate | Yes | Yes | Yes | No | Yes (Sarvam) |
| Custom workflows | Yes (account) | No | Actions/Wizard | No | Yes, browser-local |
| Mobile/desktop apps | Yes | Yes | Yes | Yes (Windows) | Web only |
| Accessibility checking/fixing | Limited | "Accessible PDF" | Yes (Pro) | PDF/UA validation | Gap |
| Shared workspace/storage | Yes | Yes | Yes | No | Deliberately absent |

Competitor sources:

- iLovePDF tools: https://www.ilovepdf.com/ (accessed 19 Nov 2026)
- Smallpdf tools: https://smallpdf.com/ (accessed 19 Nov 2026)
- Adobe Acrobat online tools: https://www.adobe.com/acrobat/online.html (accessed 19 Nov 2026)
- PDF24 all tools: https://tools.pdf24.org/en/all-tools (accessed 19 Nov 2026)

**Conclusion:** "Another PDF toolbox" is not a viable position. APOS needs a smaller number of capabilities that competitors cannot honestly match: local-first processing, privacy verification, cross-format editing, and intelligence that explains what happened to a document.

## 2. APOS Originals — candidate features

These are product directions, not claims that no competitor has ever shipped something adjacent. Each one should be validated with real users before it is marketed as unique.

### A. Document Passport + Privacy X-ray (implemented in this branch)

**What it is:** One scan that produces a fingerprint and share-readiness report: true file type, SHA-256, metadata, pages, page sizes, text layer, scanned pages, annotations, form fields, attachments, embedded files, JavaScript, external links, optional layers, macros, embedded objects, external relationships and image EXIF. It then creates a clean PDF with metadata, annotations, links, form widgets, attachments and JavaScript removed, and verifies the page count and page sizes.

**Why it is different:** iLovePDF and Smallpdf offer a metadata remover or a PDF info screen; Adobe and PDF24 have professional sanitisation/validation. A consumer-friendly **risk score + plain-language explanation + verifiable clean copy + no upload** is a differentiated combination. It also turns privacy from a slogan into a visible artifact.

**Limits:** It is a review aid. It cannot detect PII inside scanned page images, cannot inspect every object in an encrypted PDF, and does not clean Office packages.

### B. Visual Fidelity / Verify (implemented in this branch)

**What it is:** After an operation, render the relevant pages before and after, compare text and pixels, and report a fidelity score: "97.8% identical, page 3 text changed, 1 picture dropped, 2 links removed". For PDF-to-Office, report text coverage, page coverage, tables found, pictures kept, and pages that need OCR. For redaction, verify that no selectable text remains inside the redacted regions.

**Why it is different:** Competitors show a download, not proof of what changed. APOS already believes in measured results; this makes that principle visible for every destructive operation.

**Feasibility:** High for PDF before/after (PDF.js rendering + canvas diff + text extraction); medium for Office output (needs a renderer or structural checks).

### C. Document Doctor (next)

**What it is:** A diagnosis-and-prescription flow: run structure, text, image, metadata, privacy, accessibility and conversion-readiness checks, then propose an ordered treatment ("OCR pages 4–7, then repair, then compress to 2 MB, then strip metadata") and run it through the workflow engine.

**Why it is different:** Existing products expose separate repair, compress, OCR and metadata buttons. A single prescription with an explanation and a one-click plan is a better experience for non-experts. It reuses APOS's workflow engine rather than adding another isolated tool.

### D. Knowledge Extractor (later)

**What it is:** Extract structured, citation-backed facts into CSV/JSON/Word: parties, dates, amounts, clauses, obligations, tables and key questions, with page references.

**Why it is different:** iLovePDF, Smallpdf and Adobe offer chat/summaries; a structured export with page citations is more useful for contracts, invoices and research. It fits the existing Sarvam integration and the no-account workspace.

### E. Batch Intelligence (later)

**What it is:** A batch dashboard that classifies each file (text PDF, scan, Office, image), detects duplicates, chooses a per-file route (OCR only where needed, compress only above a threshold), records a manifest, and reports exceptions. The workflow builder already provides the execution engine.

**Why it is different:** iLovePDF workflows are fixed sequences; conditional routing based on File DNA is a meaningful step up.

### F. Local Compare & Explain (later)

**What it is:** Browser-local text + visual PDF comparison with a plain-language "what changed" explanation and page links.

**Why it is different:** iLovePDF and PDF24 compare visually; Adobe has compare in Acrobat. A local-first compare with an explanation and no account is a useful niche, especially for contracts.

## 3. Deliberate non-goals

- Do not add storage, accounts, team workspaces or a document cloud in this phase. They contradict the positioning and introduce operational cost.
- Do not add 50 shallow tools to match PDF24's catalogue.
- Do not claim a tool is unique because it is local if the same operation exists elsewhere. The differentiation is the privacy/verification workflow, not the existence of "merge PDF".
- Do not add AI features that send whole files when extracted text is sufficient.

## 4. Recommended sequence

1. **Ship Document Passport and Verify & Compare** and the current correctness fixes. Use them to anchor the privacy and proof story.
2. **Extend Verify** to PDF-to-Office output and add redaction verification inside Redact PDF. This is the strongest "proof" feature.
3. **Add Document Doctor** on top of the workflow engine.
4. **Add Knowledge Extractor** once structured extraction can be evaluated against real documents.
5. **Add Batch Intelligence** when there is evidence that users run recurring batches.
6. Add table-stakes gaps (PDF to Markdown, local form filling, flatten, PDF/A validation) only when they block adoption.

## 5. Success metrics

- Passport: percentage of scans that produce at least one actionable flag; percentage of users who download a clean copy; false-positive reports.
- Verify: percentage of operations with a fidelity report; user override rate; support tickets about "the output changed".
- Document Doctor: time to a usable file; percentage of prescriptions completed; repeat use.
- Product: weekly active users, tools per session, return rate, and privacy-claim complaints (target: zero misleading impressions).
