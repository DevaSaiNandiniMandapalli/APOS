# APOS — Advanced Professional Office Suite

APOS is an online-first office productivity suite built around a privacy-first, database-free foundation. Phase 1 provides original branding, a responsive dashboard, a validated tool registry, searchable planned-tool directory, and a minimal FastAPI health endpoint.

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
npm.cmd run test:e2e
npm.cmd run lint
npm.cmd run typecheck
backend/.venv/Scripts/python.exe -m pytest backend/tests
```

## Architecture and status

- The studio definitions in `src/lib/registry.ts` are the canonical source for derived studio IDs and navigation. Runtime Zod validation checks IDs, statuses, explanations, and references.
- Every listed tool is `planned`. A directory card is not an indication that a tool is implemented or available.
- `backend/` contains a modular FastAPI application. There is no database, queue, persistent file storage, account system, or file-processing route.
- `docs/PHASE-1.md` records the implementation boundary and remaining roadmap.
