# Phase 3 — Conversion and bulk processing

Phase 3 is in progress. The first conversion milestone establishes a browser-local capability registry and bounded batch scheduler, then releases a real PDF-to-text converter. Phase 4 has not started.

## Current converter statuses

| Capability | Registry status | Details |
| --- | --- | --- |
| PDF to PNG/JPG | Available | Uses the Phase 2 PDF.js rendering tool, including page selection, resolution/quality controls and validated downloads. |
| PDF to UTF-8 text | Available | Extracts selectable page text in the source PDF's encoded reading order. Supports batches up to 20 PDFs. |
| PDF to HTML | Available | Extracts selectable page text into a self-contained HTML reading view with escaped text; visual layout conversion is not claimed. |
| PDF to Word/Excel | Available | Text-faithful export to .docx or .xlsx built in the browser. Layout, images, columns and fonts are not reconstructed and the UI says so. |
| Word, Excel and PowerPoint to PDF | Available | Text-faithful PDF output: .docx reflowed paragraphs, .xlsx/.csv printed as a paginated table, .pptx exported one text page per slide. No server engine is used. |
| JPG/PNG/WebP conversions, resizing and compression | Available | Browser-local conversion with aspect-preserving resize and quality control; PNG output is lossless. |
| TIFF input | Available | First page of classic, uncompressed, 8-bit grayscale or RGB TIFF images; unsupported variants are rejected with a specific message. |

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

Phase 3 conversion work is complete. Every converter listed above is implemented, registered as `available`, and covered by unit and browser tests. Later converter work must re-run the full checks.

## Completion milestone — Office conversions

`src/lib/office-formats.ts` reads and writes OOXML packages with `fflate`: `buildDocx`/`readDocxParagraphs`, `buildXlsx`/`readXlsxRows`, and `readPptxSlides`. `src/lib/office-pdf.ts` lays text out with `pdf-lib` standard fonts (paragraph reflow, paginated tables, one landscape page per slide) and maps characters the WinAnsi encoding cannot express. `src/lib/office-convert.ts` holds the mode definitions and the conversion entry point used by `src/components/office-convert.tsx` for the four routes.

Honest limits, stated in the UI:

- PDF → Word/Excel carries text only. Columns are inferred from spacing for spreadsheets; images, fonts and page layout are not reproduced. A PDF with no selectable text is refused and pointed at the OCR PDF tool.
- Word → PDF reflows paragraphs; styles, tables, headers and images are not rendered.
- Excel/CSV → PDF prints the first worksheet (or the delimited file) as a table. At most 5000 rows, 40 columns and the first 12 columns are printed.
- PowerPoint → PDF prints slide text one page per slide; images, notes and animations are not carried.
- All conversions run in the browser. No file leaves the device and no server conversion engine is involved.

Generated packages were opened with real consumers during verification: `python-docx` read the emitted `.docx`, `openpyxl` read the emitted `.xlsx`, and `pypdf` parsed each emitted PDF.

## Verification record — completion milestone

- `npm test` — 233 tests across 31 files passed.
- `npm run test:e2e -- --workers=1` — 102 browser tests passed.
- `npm run typecheck`, `npm run lint` (0 errors, 18 warnings), `npm run build` — passed.
