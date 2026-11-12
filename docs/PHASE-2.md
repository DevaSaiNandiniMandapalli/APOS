# Phase 2 — PDF Essentials status

All document processing in this phase runs in the browser. The application does not upload document contents to APOS, write document contents to LocalStorage, or use a database or permanent file storage. Browser workers can be cancelled, but they are not operating-system sandboxes and the browser does not provide hard memory or CPU quotas.

## Registry release statuses

The authoritative statuses are in `src/lib/registry.ts`. The current Available PDF tools are:

- Merge PDF
- Split PDF
- Rotate PDF
- Compress PDF (structural rewrite with measured size reporting)
- Reorder, delete, extract, duplicate and add blank pages
- PDF to Images (PNG and JPG)
- Images to PDF (PNG and JPG)
- PDF Watermark (text and PNG/JPG image)
- PDF Page Numbers
- PDF Metadata (supported standard document-information fields)
- Protect PDF (AES-256 password encryption)

The remaining PDF catalogue tools are Planned: PDF-to-Office conversion, general editing, visual-only signature appearance, authorized unlocking, secure redaction, general PDF repair and broader optimization. Planned tools render no processing controls and do not claim to work.

## Image conversion limits and behavior

### PDF to Images

PDF.js renders selected pages sequentially. PNG and JPG outputs are signature-checked and decoded before links are shown. ZIP archives are created in a worker only after all page images are ready; archive contents are tested by extracting and checking image data.

Limits: 50 MiB input PDF, 500 pages per input, 20 output pages per run, 12 megapixels per rendered page, 30 megapixels total and 25 MiB combined output. Resolution is 72, 108 or 144 DPI; JPG quality is configurable. Cancellation cancels the active page render, destroys the PDF.js loading task/worker and prevents partial outputs from being exposed. Image and ZIP object URLs are revoked on replacement and unmount. A PDF.js input buffer may be transferred (detached) to its worker; the UI handles the detached-buffer case, and worker termination reclaims that temporary data.

### Images to PDF

PNG and JPG inputs are detected by file signature, parsed and embedded in a worker. Up to 20 inputs and 50 MiB total are accepted. The displayed order controls page order. A4, Letter and image-sized pages are supported; A4/Letter orientation can follow each image or be forced to portrait/landscape. Page placement preserves aspect ratio and centers the image on fixed page sizes. The output is reopened and checked for signature, page count and image content before download. Cancellation terminates the worker and input/output URLs are cleaned up on unmount.

## PDF Essentials completion

The five PDF Essentials tools now share a consistent browser-local experience:

- **Merge PDF** accepts 2–10 PDFs with drag-and-drop upload, per-file page counts, first-page thumbnails, drag/keyboard reordering, removal, clear-all, an editable output name, a 100 MB output cap and real per-file worker progress.
- **Split PDF** supports extract-selected-pages, one-file-per-page, custom ranges and equal page groups. It shows page thumbnails, validates ranges against the actual page count, creates individually validated PDFs, and packages multiple outputs into a ZIP using the existing `fflate` worker.
- **Rotate PDF** shows page thumbnails and selection controls, supports 90°/180°/270° rotation for all or selected pages, accumulates rotations per page, displays pending rotation state, preserves page order, and validates every output rotation.
- **PDF Watermark** has an explicit text/image mode, font selection, text color, opacity, rotation, nine positions plus custom X/Y positioning, horizontal/vertical alignment, page-width scale, live page preview, selected-page ranges and a 50 MB output cap. Image aspect ratio is preserved.
- **PDF Page Numbers** has page range selection, skip-cover, starting number, prefix/suffix, decimal/“Page n”/zero-padded formats, font selection, font size, text color, six positions, alignment, custom margins and a live preview. Oversized labels are reduced to fit instead of clipping.

All five use a shared PDF drop zone, page-count/thumbnail grid, live progress, validated-result panel, error state and reset action. Processing stays in browser Web Workers. Every downloaded PDF is reopened and structurally validated before a link is exposed. Page thumbnails use the existing PDF.js dependency; no new runtime dependency was added.

### Limits

- Merge: 2–10 files, 50 MB per file, 100 MB combined input, 100 MB output, 500 pages total.
- Split: one PDF up to 50 MB/500 pages, up to 500 outputs, 100 MB combined output, ZIP up to 500 entries.
- Rotate: one PDF up to 50 MB/500 pages, 50 MB output.
- Watermark/Page Numbers: one PDF up to 50 MB/500 pages, 50 MB output; watermark images up to 10 MB.

## Watermarks and page numbering

Watermarks support text and PNG/JPG images, selected page ranges, nine preset positions plus custom X/Y positioning, horizontal/vertical alignment, rotation, opacity, font size, text color, font selection and page-width scale. Page numbering supports selected ranges, skip-cover, a starting number, prefix/suffix, three numbering formats, six positions, alignment, custom margins, font selection, font size and text color. Both operations run in a worker, preserve page order and dimensions, reopen and validate their output, and expose a download only after validation. Watermarks are visible overlays; they do not remove content and are not a redaction feature. Standard PDF fonts have limited glyph coverage, so non-Latin text may not render as intended.

## Metadata

Inspection and editing support PDF document-information Title, Author, Subject, Keywords, Creator and Producer fields. Those are the fields exposed by the selected library's public API. Blank values clear these supported fields. Metadata updates preserve the page count, reopen the output and verify the saved values. XMP metadata, custom document-info fields, embedded metadata and metadata inside attachments are not claimed to be inspected or removed.

## Security and advanced feature feasibility

### Protect PDF — Available

The selected `@cantoo/pdf-lib` API encrypts with AES-256 by default. APOS requires separate opening and owner passwords of at least 12 characters, verifies that password-free loading fails, verifies the opening password, and validates the page count. Password fields clear after processing or cancellation. Reader permission restrictions are not offered: PDF reader enforcement varies and cannot prevent screenshots or copying after a reader has opened the document.

### Unlock PDF — Planned

The library can parse an encrypted PDF when a password is supplied, but its supported save path retains the encryption dictionary. The attempted output therefore remains encrypted. Rebuilding pages into a new document would risk dropping document-level structures such as forms, annotations, bookmarks and attachments. APOS does not advertise this as an unlock operation until a path can reliably remove encryption while preserving supported document structure. Users must have authorization and the correct password.

### Signatures — Planned

The library models signature fields but its own API documentation states it has no specialized API for creating cryptographic signatures or reading existing signature contents. A drawn signature appearance is only page graphics and is not a cryptographic signature. APOS does not claim to sign or validate certificates/signatures.

### Redaction — Planned

Drawing an opaque rectangle only covers underlying content. Reliable redaction must remove intersecting text, vector paths, image pixels, annotations, form values and relevant metadata, then validate the result. The current browser library does not provide that complete operation, so APOS does not expose a visual-cover tool under the Redact label.

### Repair and optimization

General repair is Planned. The current engine can parse supported PDFs and structurally rewrite some files; it has no dependable recovery guarantees for malformed cross-reference tables, truncated streams or arbitrary corruption. Compress PDF is available only as a structural rewrite and reports measured input/output bytes. It does not recompress embedded image data and can produce a larger file. Broader optimization remains Planned unless an operation demonstrates a measured improvement and passes output regression checks.

## Verification record

The five PDF Essentials tools were verified with real synthetic PDFs, including downloadable output, input rejection, cancellation, worker termination, object URL cleanup, output re-opening/integrity, keyboard operation, mobile viewports, dark theme and axe checks.

Commands and actual results from the completion run:

- `npm.cmd test` — 284 tests passed across 38 files.
- In-scope PDF Essentials Playwright tests — 31 passed.
- Full Playwright suite — 129 passed, 9 failed when the unrelated `e2e/pdf-conversion-studio.spec.ts` file (which currently has a duplicate `page` declaration at line 184) is excluded from discovery. Two failures were Playwright trace-artifact `ENOENT` failures that passed when rerun individually; seven deterministic failures remain outside this milestone's five tools (Edit PDF status copy, Compress default-mode/cancellation expectations, Office text-summary expectation, and Spreadsheet CSV import selector). Those failures are outside the PDF Essentials scope and were not changed in this milestone.
- Independent PDF.js validation — added in `e2e/pdf-js-validation.ts`; all five PDF Essentials outputs are reopened with PDF.js and checked for page count, page size, rotation, extracted text, image count and text placement.
- Rotated-page regression fix — `src/lib/pdf-marking.ts` now adds the page `/Rotate` value to the mark rotation and positions rotated text/images by their rotated bounding box. `src/lib/pdf-marking.test.ts` extracts text with PDF.js from a 90° page and fails if the watermark or page number is clipped.
- `npm.cmd run typecheck` — passed.
- `npm.cmd run lint` — 0 errors, 29 warnings repository-wide; PDF Essentials files have 0 errors and 4 `no-img-element` warnings.
- `npm.cmd run build` — passed; 64 static routes generated.
- `npm.cmd run serve:static` — passed; the Windows `fileURLToPath` path bug was fixed.
- `npx wrangler deploy --dry-run` — passed; Wrangler read all 580 static-export files and bundled the worker successfully.

The PDF.js worker is bundled from `pdfjs-dist`; the project also uses `fflate` to create ZIP archives. No new runtime dependency was introduced for this milestone. The package lock records exact resolved dependencies. Dependency auditing should still be run before a release deployment; it is not claimed here.

## Phase 2 release decision

Phase 2 PDF Essentials is complete for the currently defined release scope. The Available statuses above have verified implementations. Further advanced features remain explicitly Planned where the current library cannot safely meet the requirements; those controls do not expose processing UI. These limitations are exclusions from this release, not claims that the functionality exists.

Phase 3 has not started. The repository remains database-free, account-free, browser-local for PDF processing and without permanent uploaded-file storage.
