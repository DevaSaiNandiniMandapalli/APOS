# Phase 6 — AI, OCR & Automation

Status: **Complete (verified)** · Branch: `lemon/design-and-build`

## AI assistant — Sarvam 105B (`/tools/ai-assistant`)

- **Server-only integration.** `POST /api/ai` runs on the Node runtime and reads
  `SARVAM_API_KEY` from the environment. The key is never sent to the browser.
  If unset, the route returns `503` with a clear message and the UI shows it.
- **Request layer** (`src/lib/ai.ts`, unit-tested): four tasks (summarize,
  rewrite, explain, chat), input validation with a 12,000-character cap,
  message construction, and a tolerant response parser (OpenAI-style
  `choices[].message.content`, or `answer` / `output` / `text`).
- **Configurable endpoint/model** via `SARVAM_API_URL` (default
  `https://api.sarvam.ai/v1/chat/completions`) and `SARVAM_MODEL` (default
  `sarvam-105b`). Auth header: `api-subscription-key`.
- **UI:** task selector, character counter, submit, error and answer panels,
  copy, clear.
- `.env.example` documents the three variables with empty placeholders.

> Note: a live model answer was not exercised here because no API key is
> configured in this workspace. Request shaping, validation and the
> unconfigured/error paths are verified. Endpoint/header names are configurable
> if the provider's contract differs.

## OCR — Image OCR (`/tools/ocr-image`)

- Real OCR via **tesseract.js 7** (`Apache-2.0`), loaded dynamically so it is
  not part of the initial bundle.
- PNG / JPG / WEBP / BMP up to 15 MB; validation is unit-tested.
- Recognized text is normalized (line endings, trailing spaces, blank lines),
  then copyable and downloadable as `.txt`.
- Runs fully in the browser; the first run downloads English language data.
- **Verified live:** a generated 900×260 PNG reading "APOS OCR TEST 2026" was
  recognized exactly as `APOS OCR TEST 2026`.

## Automation — Workflow builder (`/tools/workflow-builder`)

- **Model** (`src/lib/workflow.ts`, unit-tested): 9-step catalog, add / remove /
  move up-down, validation (name, ≥1 step, known types), JSON serialize/parse
  with unknown-step rejection.
- **UI:** name, step picker, ordered step list with reorder/remove, live
  validation status, copy plan, save/open JSON.

## Verification (actual)
- `npm run typecheck` — 0 errors; `npm run lint` — 0 errors
- `npm test` — **202/202** (27 files; +17 new)
- backend `pytest` — 3/3
- `npm run build` — pass
- Playwright full suite — **86/86**, including 7 new tests:
  - `e2e/ai-assistant.spec.ts` (3): empty-input validation, 503 unconfigured
    path, character count.
  - `e2e/ocr-tool.spec.ts` (2): rejects non-images, accepts an image.
  - `e2e/workflow-builder.spec.ts` (2): add/reorder/remove, JSON download.
- Per-tool axe accessibility checks pass on all three pages.

## AI milestone additions

- **Document summary** (`/tools/document-summary`) extracts text from PDF, `.docx`, plain text, Markdown, CSV or JSON in the browser, sends only a bounded excerpt (12,000 characters) to `POST /api/ai`, and supports a follow-up question against the same document. Long documents are summarised from their opening section and the result says so.
- **OCR PDF** (`/tools/ocr-pdf`) renders selected PDF pages in the browser and recognises text with Tesseract; the English model downloads on first use. Up to 20 pages per run, 25 MB per PDF.
- Both tools degrade honestly: without `SARVAM_API_KEY` the summary tool shows the server's configuration message, and OCR never claims accuracy beyond what Tesseract returned.
