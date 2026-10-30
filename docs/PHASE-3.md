# Phase 3 — Conversion and bulk processing

Phase 3 is in progress. The first conversion milestone establishes a browser-local capability registry and bounded batch scheduler, then releases a real PDF-to-text converter. Phase 4 has not started.

## Current converter statuses

| Capability | Registry status | Details |
| --- | --- | --- |
| PDF to PNG/JPG | Available | Uses the Phase 2 PDF.js rendering tool, including page selection, resolution/quality controls and validated downloads. |
| PDF to UTF-8 text | Available | Extracts selectable page text in the source PDF's encoded reading order. Supports batches up to 20 PDFs. |
| PDF to HTML | Available | Extracts selectable page text into a self-contained HTML reading view with escaped text; visual layout conversion is not claimed. |
| PDF to Word/Excel/PowerPoint | Planned | Browser library does not provide reliable fidelity-preserving conversions. No conversion claim is made. |
| Word, Excel and PowerPoint to PDF | Planned | Requires an evaluated conversion engine and, for LibreOffice, a secured isolated server-side processing boundary. |
| JPG/PNG/WebP conversions, resizing and compression | Planned | Image converter vertical slice remains outstanding. |
| TIFF conversions | Planned | Browser decoder compatibility is not consistent enough for an advertised path. |

Only the implemented converters are registered in `src/lib/conversion-engine.ts`: `pdf-to-text` and, since the semantic HTML reading view milestone, `pdf-to-html`. The declared format vocabulary and signature detection support planning the next converters; format detection does not imply conversion support. Other routes remain Planned.

## PDF-to-text behavior and limits

- PDF files are detected from their signature and parsed with the existing `pdfjs-dist` dependency. No files are uploaded to the API.
- The batch accepts at most 20 files, 25 MiB per file, 100 MiB total input, 500 pages per PDF, 20 MiB per text output and 100 MiB total outputs. At most two PDFs are parsed concurrently.
- Each PDF is processed page by page. Progress reports completed and total pages. Text output is UTF-8 validated before an individual download is exposed.
- Global page heading configuration can be overridden for each file. Output names are sanitized and duplicate names receive deterministic numbered suffixes.
- Valid PDFs with no selectable text can produce an empty text file. Scanned image pages require OCR, which is not part of this converter. Reading order follows the order encoded in the PDF; APOS does not claim reconstruction of columns, tables, fonts or visual layout.
- Unsupported file signatures fail individually, while valid PDFs can still complete. Failed files can be retried; queued or failed items can be skipped. Error reports contain names and processing errors, not document content.
- ZIP creation runs in a worker after validated outputs exist. Its archive signature and actual contents are checked in browser tests. Individual outputs remain available if ZIP generation is cancelled.
- PDF.js owns/transfers parsing buffers to its worker in some browsers. Cancellation and route cleanup destroy active loading tasks; the page releases generated object URLs on clear and unmount. Browser workers provide bounded concurrency but are not OS-level sandboxes, and browsers do not guarantee hard memory quotas.

## Architecture

`src/lib/conversion-engine.ts` holds format and converter capability types, the verified converter declaration, signature-based format detection, input/output limits and validation, deterministic filename resolution, and a shared bounded queue runner. `src/lib/pdf-to-text.ts` adapts PDF.js to that contract. `src/components/pdf-to-text.tsx` owns transient batch UI state, cancellation controllers and output URLs. `src/workers/zip-files.worker.ts` packages already validated outputs.

No conversion dependency was added for this milestone. Existing `pdfjs-dist` handles PDF parsing and `fflate` creates ZIP files. No server conversion or document storage was introduced. Office conversion engine and license evaluation is outstanding; Office formats remain Planned until that review and an isolated processing design exist.

## Verification record

First milestone checks:

- `npm.cmd test -- --run` — 63 unit tests passed across 13 files.
- `npm.cmd run test:e2e -- --workers=1` — all 50 browser tests passed, covering the Phase 1/2 checks and the PDF-to-text and PDF-to-html checks. The PDF-to-text coverage includes real downloads and ZIP extraction, mixed-format partial failure, retry/skip, PDF and ZIP worker cancellation, URL cleanup, mobile accessibility and a 20-file batch.
- `npm.cmd run typecheck` — passed.
- `npm.cmd run lint` — passed.
- `npm.cmd run build` — passed; 51 static routes generated.
- `python -m pytest backend/tests` — 3 tests passed.
- `npm.cmd audit --audit-level=high` — 0 vulnerabilities reported.
- `git diff --check` — passed; Git reported only line-ending conversion notices.

The ZIP archive download name was corrected during this handover: the batch UI derived the suggested archive filename from the internal format id (`txt`), producing `apos-converted-txt.zip`, while the release expectation is `apos-converted-text.zip`. The converter now maps the text output kind correctly; the full browser suite passes again.

Phase 3 release is not complete. The full checks now pass again after the ZIP archive naming correction; the Phase 3 release gate still requires sign-off before Phase 4 work begins, and later converter work must re-run the full checks.
