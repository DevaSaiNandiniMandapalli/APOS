# APOS — Advanced Professional Office Suite

APOS is an online-first office productivity suite built around a privacy-first, database-free foundation. Phase 1 provides the original responsive dashboard, studio directory and validated tool registry. Phase 2 provides browser-local PDF Essentials tools with real processing and downloads. Phase 3 adds browser-local PDF-to-text conversion with a bounded batch engine, plus the PDF-to-HTML semantic reading view; both are available on this device.

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

Run the production build before browser checks. Keep the production server running in one terminal while running Playwright from another:

```powershell
npm.cmd run build
npm.cmd run start
```

```powershell
npm.cmd test
npm.cmd run test:e2e -- --workers=1
npm.cmd run lint
npm.cmd run typecheck
backend/.venv/Scripts/python.exe -m pytest backend/tests
```

## Architecture and status

- The studio definitions in `src/lib/registry.ts` are the canonical source for derived studio IDs and navigation. Runtime Zod validation checks IDs, statuses, explanations, and references.
- Available PDF tools include Merge, Split, Rotate, Reorder, Delete, Extract, Duplicate, Add Blank Pages, structural Compress, PDF to Images, PDF to Text, Images to PDF, text/image Watermark, Page Numbers, supported Metadata inspection/editing, and AES-256 Protect PDF. PDF-to-text batches support up to 20 files with bounded concurrency. Unlocking, signatures, secure redaction, general repair, and broader optimization remain planned with limitations recorded in `docs/PHASE-2.md`. Other catalogue tools remain planned unless their status says otherwise. A directory card alone never indicates availability.
- Browser-local processing uses `@cantoo/pdf-lib`, `pdfjs-dist` and `fflate`; see the lockfile for exact resolved versions. PDF-to-text uses the existing PDF.js dependency; PDF-to-HTML wraps validated PDF text extraction in a self-contained HTML document. Office conversion engines and image conversion formats are still under evaluation and remain Planned. Run `npm.cmd audit --audit-level=high` before dependency releases.
- `backend/` contains a modular FastAPI application. There is no database, queue, persistent file storage, account system, or file-processing route.
- `docs/PHASE-1.md` records the implementation boundary and remaining roadmap.
- `docs/PHASE-2-PLAN.md` defines the incremental PDF Essentials plan and its release gates.
- `docs/PHASE-3.md` records conversion capability statuses, PDF-to-text limits and the first batch-processing milestone.
- **Permanent principle:** 100% functionality, no dead buttons, no fake features. See Section 16 of `AGENTS.md`; every phase ends with a full UI control and route audit.
