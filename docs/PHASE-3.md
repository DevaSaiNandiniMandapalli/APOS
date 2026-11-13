# Phase 3 — PDF Conversion Studio

All five PDF Conversion Studio tools run in the browser. No document content is uploaded, no application database is used, and no temporary file is stored on a server. The only network request made by these tools is fetching the existing PDF.js worker and application chunks.

## Release status

The authoritative registry in `src/lib/registry.ts` marks these tools **Available**:

| Tool | Implementation |
| --- | --- |
| PDF to Office | Structured text, heading, paragraph and table extraction; real DOCX and XLSX packages; editable Word with content pictures and source page sizes; separate visual page-picture mode; per-page image-only detection and optional OCR; page ranges; previews; output validation |
| PDF to Images | All/selected/ranged pages; PNG/JPG; 72, 108, 144, 150, 200 and 300 DPI; JPEG quality; background colour; page thumbnails; individual and ZIP downloads |
| PDF to Text | UTF-8 extraction; page ranges; page headings; batch conversion; text preview; copy; empty-page and scanned-page reporting; ZIP and error report |
| PDF to HTML | Safe semantic reading mode and approximate layout mode; headings, paragraphs, tables and pictures; page labels; standalone HTML and complete ZIP package |
| Images to PDF | JPG/PNG; ordering and drag reorder; previews; A3/A4/A5/Letter/Legal/natural/custom pages; orientation; margins; fit/fill/original/center; background; JPEG/PNG recompression; validated output |

## Audit findings and changes

### Before this milestone

- **PDF to Office** extracted plain text into a single Word paragraph sequence and put all page pictures at the end. The Excel path inferred columns from spaces in plain text. There was no page range, heading/table detection, preview, visual mode or structured workbook.
- **PDF to Images** rendered genuine page images but only offered 72, 108 and 144 DPI, had no page thumbnails, no background colour and no output-name control.
- **PDF to Text** had a strong batch engine but no page ranges, preview, copy action, empty-page reporting or scanned-page explanation in the result.
- **PDF to HTML** generated a single preformatted reading view with data-URL pictures. It had no headings, tables, layout mode or downloadable resource package.
- **Images to PDF** embedded images correctly but only supported A4, Letter and natural-size pages, with automatic/forced orientation and fit-to-page placement.

### After this milestone

- PDF-to-Office extraction now uses positioned text runs, visual line grouping, heading detection, paragraph reconstruction, table detection, page boundaries and picture extraction. DOCX and XLSX are generated as real ZIP-based Office packages and reopened/structurally validated.
- PDF-to-Images now renders at screen, draft and print resolutions, shows page thumbnails, supports background colour and filename prefixes, checks the exact bitmap dimensions, and releases canvases and PDF.js tasks.
- PDF-to-Text now supports page ranges, preview/copy, empty-page warnings and an explicit scanned/blank PDF failure instead of silently producing an empty file.
- PDF-to-HTML now produces escaped semantic HTML with headings, paragraphs, tables and pictures, a layout mode with positioned text, a CSP that disables scripts, and a ZIP package whose assets are referenced and checked.
- Images-to-PDF now has full page-size, orientation, margin and placement controls, image previews and reordering, background colour, optional recompression and a custom output filename, with output page dimensions checked against the settings.

## PDF to Office runtime path

Both the PDF to Office tool and the universal converter call `convertPdfToOffice()` in `src/lib/pdf-to-office.ts`. There is no second PDF-to-Word implementation and no page-picture fallback in editable mode.

- Editable Word extracts text and detected tables, places content pictures by their source y-position, preserves source page sizes and boundaries, and audits the generated DOCX before exposing a download.
- Image-only pages are detected individually from the PDF text layer and image operators. Without OCR, conversion stops with the affected page numbers. With OCR enabled, those pages are rendered, recognised and inserted as editable text; no page screenshots are inserted.
- Visual Word is a separate renderer. It renders each page as one picture, preserves page order and size, and is explicitly not editable.
- Image placement is computed from the PDF content-stream transformation matrix. An image that cannot be placed is reported and skipped; it never causes the whole page to be rasterized.

The regression fixture in `e2e/pdf-word-regression.spec.ts` covers a five-page document with `PAGE_MARKER_1`–`PAGE_MARKER_5`, a normal content image on page 3, an identity-transform image on page 4, a hybrid text/image-only PDF, OCR, Visual Word and the universal converter. Downloaded DOCX files are reopened in the tests and inspected as ZIP/XML packages.

## Security and privacy

- File signatures are checked before processing. File names and MIME types are not trusted.
- PDF.js is used only in the browser. Its worker is loaded from the application bundle.
- DOCX/XLSX packages are generated with `fflate` and `@cantoo/pdf-lib`; generated relationships and media parts are validated before a download is shown.
- HTML text and attribute values are escaped. The generated document includes a Content Security Policy that blocks scripts, objects, forms and external defaults. ZIP entry names reject absolute paths, `..` and backslashes; asset references are checked against archive entries.
- Image outputs are signature-checked and decoded with `createImageBitmap`; their dimensions are compared with the requested viewport.
- Images-to-PDF runs in a Web Worker, reopens the generated PDF with the installed PDF library, checks page count and page geometry, and exposes no link on failure.
- Object URLs are revoked on reset, replacement and route unmount. PDF.js loading tasks, render tasks and workers are destroyed/terminated on cancellation and unmount.
- No document content is written to LocalStorage, IndexedDB or the network by these tools.

## Limits

- **PDF to Office:** 25 MB input; 500 pages; DOCX/XLSX output cap 30 MB; visual Word mode is limited to 100 pages per run; OCR is limited to 20 pages per run and uses English Tesseract. Editable Word never inserts full-page screenshots: image-only pages either fail with their page numbers or are OCR’d when the user enables OCR. Full-page backgrounds are skipped and reported. Complex multi-column layouts, forms, annotations, exact fonts, vertical merges and inline picture anchoring are not reconstructed. XLSX cell values are text, not formulas. Table detection is heuristic and is reported as such.
- **PDF to Images:** 50 MB input, 500 PDF pages, 500 output pages per run, 12 megapixels per page, 200 megapixels total, 50 MB combined output. 300 DPI on large pages can exceed the per-page or total limits; the tool reports this rather than truncating.
- **PDF to Text:** 20 files per batch, 25 MB per file, 100 MB per batch, 500 pages per PDF, 20 MB text output. Only selectable text is extracted. Scanned pages require local OCR first; OCR is not silently substituted.
- **PDF to HTML:** 20 files per batch, 25 MB per file, 500 pages per PDF. Reading order follows the encoded PDF content stream. Layout mode is approximate and does not reproduce fonts exactly. The standalone HTML embeds pictures as data URLs; the ZIP package uses `assets/` files.
- **Images to PDF:** 20 images, 50 MB combined, 12,000 pixels per side and 40 megapixels per image. PNG and JPEG only. Recompression uses `OffscreenCanvas`; browsers without it get a clear error. “Original image dimensions” uses one PDF point per image pixel; “Original size” placement assumes 96 DPI. Fill mode may crop at the page edge by design.

## Verification

Commands run from the repository root:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npx playwright test e2e/pdf-word-regression.spec.ts e2e/pdf-conversion-studio.spec.ts e2e/office-convert.spec.ts e2e/universal-convert.spec.ts --workers=1
npx playwright test --workers=2
npx wrangler deploy --dry-run
```

Results from the PDF-to-Word fix verification:

- `npm.cmd test` - 309 tests passed across 43 files.
- `npm.cmd run typecheck` - passed.
- `npm.cmd run lint` - 0 errors; 29 warnings, dominated by existing `<img>` notices for canvas/data-URL previews and pre-existing unused-variable warnings.
- `npm.cmd run build` - passed; 65 static routes generated, including `/server-tools`.
- Focused PDF/Office Playwright run - 29 passed.
- Full Playwright suite `npx playwright test --workers=2` - 159 passed, 1 skipped (the real FastAPI integration test requires `APOS_LIVE_BACKEND=1`). The skipped test passed separately against the live local backend.
- `backend/.venv/Scripts/python.exe -m pytest backend/tests -q` - 17 passed.
- `npx wrangler deploy --dry-run` - passed; the Worker and static assets bundle without errors.

The regression fixture was downloaded through the real PDF-to-Office UI and reopened with Python `python-docx`. All five `PAGE_MARKER_1`–`PAGE_MARKER_5` markers appeared exactly once and in order; the DOCX contained one 180 × 120 pt content image on page 3, no page-sized screenshots, four page breaks, a real Word table in the table fixture, and editable identity-transform page 4 text. The Universal Converter produced the same result. A hybrid PDF with image-only pages 3–5 stopped with those page numbers and no download. With OCR enabled, the image-only page produced editable text and no page media. These Python packages are external verifiers and are not project dependencies.

## Known limitations and honest status

The tools are useful for real conversion, but they are not a replacement for a full desktop layout engine. PDF text extraction cannot reconstruct glyph-perfect typography, complex columns, rotated text, form fields, annotations or every embedded picture. Visual Word is a page-image mode and is not editable; Editable Word never falls back to page screenshots. HTML layout mode approximates positions with CSS and remains responsive, so it may reflow. Scanned documents remain OCR-dependent and are reported page by page.

The browser-local PDF Conversion Studio introduced no database, account system, server-side document retention or automatic upload path. The static-export and Cloudflare Worker architecture is unchanged for browser tools.

## Optional server processing bridge

A separate, optional FastAPI service now lives under `backend/`. It vendors the MIT-licensed APOS/pdfsmith processing code supplied for this project and exposes advanced native engines (LibreOffice, Ghostscript, pyHanko, OCRmyPDF, WeasyPrint, pdf2docx and pdfplumber) at `/api/v1/tools`. The current branded frontend consumes it through the clearly labelled `/server-tools` page. Browser-local registry tools remain browser-local and unchanged. See `docs/SELF-HOSTING-SERVER-TOOLS.md` for setup, deployment, limits and the privacy distinction.
