# Document Passport

**Status:** Available in the browser, no upload.  
**Route:** `/tools/document-passport`  
**Code:** `src/lib/document-passport.ts`, `src/components/document-passport.tsx`

## What it does

Document Passport is APOS's file-intelligence and privacy screen. It reads a PDF, DOCX, XLSX, PPTX or supported image in the browser and produces:

- a cryptographic fingerprint (SHA-256) and true signature-based file type;
- PDF page count, page sizes, metadata, encryption, annotations, form fields, attachments, JavaScript, external links, optional layers and signature markers;
- PDF text-layer sampling (up to 20 pages) to identify scans and image-only pages;
- Office package inspection: parts, paragraphs/worksheets/slides, media, macros, embedded objects, external relationships, package signatures and core properties;
- image format, dimensions and EXIF presence;
- a weighted 0–100 share-readiness score and plain-language flags;
- a JSON report download;
- a **clean PDF copy** action that removes metadata, annotations, links, form widgets, attachments and JavaScript, then verifies page count and page sizes.

## Privacy model

- The file is read with browser APIs only.
- No file content is uploaded.
- The scan result stays in the tab unless the user downloads the JSON report.
- The report is a review aid, not a legal guarantee. It cannot find PII inside scanned images and cannot fully inspect encrypted PDFs.

## Clean-copy guarantees and limits

The clean copy:

- keeps every page, page size and visible page content;
- drops document metadata, annotations/comments, links, form widgets, attachments, JavaScript actions, bookmarks and tag structure;
- does not OCR, redact visible text, or remove text from the page content stream;
- is available for unencrypted PDFs up to 25 MB and 500 pages;
- is verified by reopening it and checking page count and page sizes before download.

Use Redact PDF for visible sensitive content, Metadata for a targeted metadata edit, and OCR PDF for scans that need a searchable text layer.

## What it does not do yet

- Office macro/embedded-object removal (the Passport explains that Office must be re-saved with those features removed).
- Image metadata rewriting (the Image converter can re-encode, but that is not a dedicated EXIF scrubber).
- Detection of PII inside scanned page images.
- Full PDF object-level audit of encrypted files.

## Tests

- Unit: `src/lib/document-passport.test.ts` (type detection, hashing, flags, clean-copy verification, Office package flags, unknown files).
- Browser: `e2e/document-passport.spec.ts` (real PDF scan, clean-copy download and reopen, mobile width).
- Accessibility: the page is included in the regression axe sweep.
