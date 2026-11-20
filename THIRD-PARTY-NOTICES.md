# Third-party notices

APOS is MIT-licensed, but it depends on third-party software with its own
licenses. This file is a practical inventory, not legal advice. Re-run a
license audit before distributing a binary/container image.

## Browser and application dependencies

| Component | License | Notes |
| --- | --- | --- |
| `@cantoo/pdf-lib` / `pdf-lib` | MIT | PDF creation and manipulation. |
| `pdfjs-dist` | Apache-2.0 | PDF rendering/text extraction; keep the upstream NOTICE. |
| `tesseract.js` | Apache-2.0 | Browser OCR; language/core data is downloaded at runtime. |
| `fflate` | MIT | ZIP creation/reading. |
| `tiff` | MIT | TIFF decoding. |
| `lexical`, `@lexical/*` | MIT | Document editor. |
| `lucide-react` | ISC | Icons. |
| `zod` | MIT | Schema validation. |
| `next`, `react`, `react-dom` | MIT | Application framework. |

## Optional Python processing service

| Component | License | Notes |
| --- | --- | --- |
| FastAPI, Pydantic, Uvicorn | MIT / MIT / BSD-3-Clause | API service. |
| `pypdf`, `reportlab` | BSD-3-Clause | PDF utilities. |
| `pikepdf` | MPL-2.0 | Used as a dependency; do not copy its source into MIT files. |
| `pypdfium2` | Apache-2.0 / BSD-3-Clause (PDFium) | Rendering. |
| `pdfplumber` | MIT | Table/text extraction. |
| `pdf2docx` | MIT | Depends on PyMuPDF, which is AGPL-3.0 or commercially licensed. |
| `PyMuPDF` | **AGPL-3.0 or commercial** | Optional server dependency. Distributing a service/image that includes it may create AGPL obligations. Review before release. |
| `pyHanko` | MIT | PAdES signing. |
| `python-pptx`, `openpyxl` | MIT | Office generation. |
| `weasyprint` | BSD-3-Clause | HTML to PDF. |
| `ocrmypdf` | MPL-2.0 | Optional OCR extra. |
| Ghostscript | **AGPL-3.0** (or commercial) | Installed in the server image for compression/PDF-A. Review distribution obligations. |
| LibreOffice | MPL-2.0 | Installed in the server image. |
| Tesseract | Apache-2.0 | OCR engine. |

## Rules for reusing code from other projects

Allowed:

- MIT, BSD, ISC and Apache-2.0 code, provided the copyright notice and license
  are retained and any NOTICE file is preserved.
- Adapting an algorithm or approach after understanding it, with an original
  implementation and attribution where required.

Not allowed:

- Copying code, assets, branding or distinctive UI from iLovePDF, Smallpdf,
  Adobe Acrobat, PDF24 or other proprietary services.
- Adding GPL/AGPL code to the browser application or to MIT-licensed source
  files without a deliberate licensing decision. Ghostscript/PyMuPDF are
  server-side optional components and should be reviewed separately.
- Removing upstream license or attribution headers.

See `docs/CODE-REUSE-POLICY.md`.
