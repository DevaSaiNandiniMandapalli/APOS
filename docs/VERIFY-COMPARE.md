# Verify & Compare

**Status:** Available in the browser, no upload.  
**Route:** `/tools/verify-compare`  
**Code:** `src/lib/pdf-verify.ts`, `src/components/verify-compare.tsx`

## What it does

Verify & Compare takes two PDFs — typically an original and a compressed, repaired, redacted, OCR'd or re-saved copy — and produces a page-by-page report:

- page count before and after;
- text similarity, added/removed word counts and character counts;
- rendered-page visual similarity;
- page-size changes;
- missing pages;
- a side-by-side preview of any page;
- a downloadable JSON report.

It is intended for the "did the operation silently damage my document?" question that a download alone cannot answer.

## Limits

- 25 MB per PDF.
- 100 pages per comparison.
- Rendered at 1.2× for speed.
- Pixel comparison ignores channel differences below 12/255, so antialiasing and encoder noise do not count as changes.
- Text comparison is word-based and case-insensitive.
- Visual comparison is a rendered-page approximation, not a proof of pixel-identical print output.

## Interpretation

- **Identical** — no page-count, size, text or visual changes above tolerance.
- **Minor differences** — close visual and text match, with at least one flagged page; review it.
- **Changed** — material page-level differences; inspect every flag.
- **Major differences** — low visual/text match or missing pages.

The report flags the page; it does not decide whether a change is acceptable for your workflow.

## Privacy

Both PDFs are read with PDF.js in the browser. They are never uploaded and the report stays in the tab unless downloaded.

## Tests

- Unit: `src/lib/pdf-verify.test.ts` (text similarity, pixel-diff counting, page classification, report summary).
- Browser: `e2e/verify-compare.spec.ts` (identical files, text change, page-count difference, mobile layout).
