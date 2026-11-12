# APOS — Advanced Professional Office Suite

APOS is an online-first office productivity suite built around a privacy-first, database-free foundation. Phase 1 provides the original responsive dashboard, studio directory and validated tool registry. Phase 2 provides browser-local PDF Essentials tools with real processing and downloads. Phase 3 adds the PDF Conversion Studio: structured PDF-to-Word/Excel export, PDF-to-Images, PDF-to-Text, PDF-to-HTML and Images-to-PDF, all running in the browser with validated output.

## Requirements

- Node.js 20.9 or newer and npm
- Python 3.11 or newer and pip

## Run the frontend

```powershell
npm.cmd install
npm.cmd run dev
```

Open http://localhost:3000. Theme and sidebar preferences are stored in LocalStorage only.

## Run the API

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -e "backend[test]"
backend/.venv/Scripts/python.exe -m uvicorn apos_api.main:app --app-dir backend --reload
```

The only API route implemented in Phase 1 is `GET /api/v1/health`. Interactive API documentation is at `/api/docs`. Processing and upload endpoints are intentionally absent.

## Checks

Run the production build before browser checks. The app uses a static export, so serve the generated `out/` directory rather than `next start`:

```powershell
npm.cmd run build
npm.cmd run serve:static
```

Playwright starts the same static server automatically when it is not already running. If you prefer a manual terminal, keep `npm.cmd run serve:static` running in one terminal while running Playwright from another:

```powershell
npm.cmd test
npm.cmd run test:e2e -- --workers=1
npm.cmd run lint
npm.cmd run typecheck
backend/.venv/Scripts/python.exe -m pytest backend/tests
```

## Architecture and status

- The studio definitions in `src/lib/registry.ts` are the canonical source for derived studio IDs and navigation. Runtime Zod validation checks IDs, statuses, explanations, and references.
- Available PDF tools include Merge, Split, Rotate, Reorder, Delete, Extract, Duplicate, Add Blank Pages, structural Compress, PDF to Images, PDF to Text, PDF to HTML, PDF to Office, Images to PDF, text/image Watermark, Page Numbers, supported Metadata inspection/editing, and AES-256 Protect PDF. PDF-to-text batches support up to 20 files with bounded concurrency. PDF-to-Office rebuilds structured headings, paragraphs, tables and content pictures into editable Word, or detected tables and text into Excel. Editable Word never falls back to full-page screenshots; image-only pages are reported for OCR, and Visual Word is a separate non-editable page-picture mode. Unlocking, signatures, secure redaction, general repair, and broader optimization remain planned with limitations recorded in `docs/PHASE-2.md`. Other catalogue tools remain planned unless their status says otherwise. A directory card alone never indicates availability.
- Browser-local processing uses `@cantoo/pdf-lib`, `pdfjs-dist`, `fflate` and the existing Office helpers; see the lockfile for exact resolved versions. PDF-to-text and PDF-to-HTML use PDF.js; DOCX/XLSX packages are generated and structurally validated in the browser. Run `npm.cmd audit --audit-level=high` before dependency releases.
- `backend/` contains a modular FastAPI application. There is no database, queue, persistent file storage, account system, or file-processing route.
- `docs/PHASE-1.md` records the implementation boundary and remaining roadmap.
- `docs/PHASE-2-PLAN.md` defines the incremental PDF Essentials plan and its release gates.
- `docs/PHASE-3.md` records the PDF Conversion Studio audit, capabilities, limits and verification results.
- **Permanent principle:** 100% functionality, no dead buttons, no fake features. See Section 16 of `AGENTS.md`; every phase ends with a full UI control and route audit.
