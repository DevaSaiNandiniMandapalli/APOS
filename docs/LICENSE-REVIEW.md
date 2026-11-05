# License review

Reviewed dependency licenses from the installed packages (`package.json`
`license` fields) on the current development branch.

## Runtime dependencies

| Package | Version | License | Notes |
| --- | --- | --- | --- |
| `next` | 16.4.3 | MIT | Permissive. |
| `react` / `react-dom` | 19.3.1 | MIT | Permissive. |
| `@cantoo/pdf-lib` | 2.11.1 | MIT | MIT fork of `pdf-lib`; used for PDF generation and export. Attribution retained via `node_modules` license file. |
| `pdfjs-dist` | 6.4.299 | Apache-2.0 | Permissive; requires retaining NOTICE. |
| `fflate` | 0.8.3 | MIT | Permissive. |
| `tiff` | 7.1.3 | MIT | Permissive. |
| `lexical`, `@lexical/*` | 0.20.2 | MIT | Permissive. |
| `lucide-react` | (installed) | ISC | Permissive. |
| `zod` | (installed) | MIT | Permissive. |
| `tesseract.js` | 7.0.0 | Apache-2.0 | OCR engine; language data is downloaded from the Tesseract CDN at runtime. |

## Development dependencies

`typescript`, `eslint`, `vitest`, `@playwright/test` — MIT / Apache-2.0.
Playwright's Chromium download is Apache-2.0 / BSD-style.

## Backend

`fastapi`, `pydantic`, `uvicorn`, `pytest`, `httpx` — MIT / BSD / Apache-2.0
(see `backend/pyproject.toml`).

## Conclusion

No copyleft (GPL/AGPL) runtime dependency is present. All runtime licenses are
permissive (MIT, ISC, Apache-2.0). Apache-2.0 packages require preserving their
license and NOTICE files in distributions; they are already included in
`node_modules` and are not modified.

_This review is a factual summary of the installed package metadata, not legal
advice._
