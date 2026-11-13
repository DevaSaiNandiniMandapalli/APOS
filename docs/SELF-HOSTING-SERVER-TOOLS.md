# Self-hosting the APOS processing server

APOS has two processing modes:

1. **Browser-local tools** — the 39 tools in the canonical studio registry. These never upload a document.
2. **Server tools** — the optional FastAPI service built from the supplied APOS/pdfsmith processing code. These tools run on your own server and are clearly labelled on `/server-tools`.

The server is optional. Without it, the browser app and every browser-local tool continue to work; `/server-tools` explains how to connect one instead of exposing dead controls.

## What the server adds

The complete processing package under `backend/apos_processing` provides 32 tools, including:

- Crop PDF, page removal, merge/split/organize/rotate
- PDF to Word (layout-preserving `pdf2docx`, page ranges, optional OCR), PDF to Excel, PDF to PowerPoint

The main `/tools/pdf-to-office` page uses this server Word engine when the user explicitly selects **Layout-preserving server**; its default remains browser-local.
- Images/Office/HTML to PDF
- PDF/A conversion
- Compress via Ghostscript, watermark and page numbers
- Protect, unlock, repair, metadata
- Real PAdES digital signatures and signature verification
- Rasterizing redaction and automatic PII redaction
- PDF comparison with text and pixel differences
- AcroForm inspection and filling
- OCR (when OCRmyPDF + Tesseract are installed)
- AI summarize/translate (when `ANTHROPIC_API_KEY` is set)
- Server-side workflow execution

Native features report as unavailable in the UI when their binary or package is missing. APOS does not claim they work when a dependency is absent.

On the Windows verification machine, 26 of the 32 server tools were available; Office-to-PDF, OCR, HTML-to-PDF and PDF/A reported missing because LibreOffice, OCRmyPDF/Tesseract, WeasyPrint's native libraries and Ghostscript were not installed. AI summarize/translate also require an API key. The Docker image installs the native dependencies so those tools can be enabled.

## Backend setup

From the repository root:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -e "backend[test]"
backend/.venv/Scripts/python.exe -m uvicorn apos_api.main:app --app-dir backend --reload --port 8000
```

On macOS/Linux use `backend/.venv/bin/python` and `backend/.venv/bin/uvicorn` instead.

Check it:

```powershell
curl.exe http://127.0.0.1:8000/api/v1/health
curl.exe http://127.0.0.1:8000/api/v1/tools
```

## Frontend configuration

For local development, set the API URL before building/starting Next.js:

```powershell
$env:NEXT_PUBLIC_APOS_API_URL="http://127.0.0.1:8000"
npm.cmd run dev
```

For a production static build:

```powershell
$env:NEXT_PUBLIC_APOS_API_URL="https://processing.example.com"
npm.cmd run build
```

`NEXT_PUBLIC_APOS_API_URL` is public and embedded in the client. If it is blank, the frontend uses same-origin `/api/v1`, which works when a reverse proxy serves both the static app and the API.

The included preview server can provide that same-origin proxy for a single-tunnel or single-port deployment:

```powershell
$env:APOS_PROCESSING_ORIGIN="http://127.0.0.1:8000"
npm.cmd run serve:static
```

`APOS_PROCESSING_ORIGIN` is only read by `scripts/serve-static.mjs`; without it, `/api/v1/*` returns a clear “processing server is not configured” response and browser-local tools are unaffected.

The API only accepts cross-origin requests from `CORS_ORIGINS`:

```powershell
$env:CORS_ORIGINS="https://apos.example.com"
```

## Deployment with Docker

`backend/Dockerfile` includes LibreOffice, Ghostscript, Tesseract, OCRmyPDF and the native libraries WeasyPrint needs:

```powershell
docker build -t apos-processing backend
docker run --rm -p 8000:8000 --name apos-processing `
  -e CORS_ORIGINS="https://apos.example.com" `
  -e ANTHROPIC_API_KEY="optional" `
  apos-processing
```

The server can also be deployed behind HTTPS on Render, Fly.io, a VPS or any container host. Cloudflare's static Worker deployment does **not** run these native binaries; the static site can point at a separately hosted API URL, or server tools remain unavailable there.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated allowed browser origins |
| `APOS_MAX_UPLOAD_MB` | `50` | Per-request upload cap |
| `APOS_MAX_FILES` | `20` | Files per request |
| `APOS_MAX_OUTPUT_MB` | `100` | Generated output cap |
| `APOS_RATE_LIMIT_REQUESTS` | `120` | Requests per window per client |
| `APOS_RATE_LIMIT_WINDOW` | `60` | Rate-limit window in seconds |
| `ANTHROPIC_API_KEY` | unset | Enables server AI summarize/translate |
| `NEXT_PUBLIC_APOS_API_URL` | blank | Frontend API base URL (build-time) |

## API

- `GET /api/v1/health`
- `GET /api/v1/tools`
- `POST /api/v1/tools/{name}` — multipart `files` plus tool options
- `POST /api/v1/workflows/run` — multipart `files` plus a JSON `steps` field
- `POST /api/v1/inspect/form-fields`
- `POST /api/v1/inspect/words`

Compatibility aliases from the supplied implementation are also available: `/healthz`, `/api/tools`, `/api/tools/{name}`, `/api/workflows/run`, `/api/inspect/form-fields` and `/api/inspect/words`.

Interactive API documentation is at `/api/docs`.

## Privacy, retention and security

- No database, account system or persistent job queue.
- Uploaded bytes are held in memory. Tools that need an external binary write only to a per-request temporary directory that is removed before returning.
- The API returns `Cache-Control: no-store` and sets defensive security headers.
- File extensions are checked against content signatures before tools run.
- Upload count, total bytes and output bytes are bounded.
- A simple in-memory rate limiter applies to processing/inspection requests; it resets on process restart.
- Do not log document contents. APOS does not add such logging.
- Temporary files and in-memory job state are lost on process restart. This is documented behaviour, not durable job processing.
- Server processing is only appropriate when the operator and user trust the configured server. Browser-local tools remain the privacy-preserving default.

## Licensing

`backend/apos_processing` is adapted from the MIT-licensed **pdfsmith** project by Vishal. The original license is preserved at `backend/apos_processing/LICENSE`; attribution is in `backend/apos_processing/NOTICE.md`.

## Verification

```powershell
backend/.venv/Scripts/python.exe -m pytest backend/tests -q
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npx playwright test e2e/server-tools.spec.ts --workers=1
```

The backend suite (18 tests) covers registry/availability, real PDF merge output, signature rejection, workflow execution, form-field inspection, PDF-to-Word (including page ranges), PDF-to-Excel/PowerPoint, PDF-to-images, crop, compare, automatic redaction and self-signed PAdES signing/verification. The Playwright suite covers the unavailable-server state, a mocked complete upload/download flow, a mocked layout-preserving Word flow and (with `APOS_LIVE_BACKEND=1`) real FastAPI merge and PDF-to-Word conversions through the pages.
