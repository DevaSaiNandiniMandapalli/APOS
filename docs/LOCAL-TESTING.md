# Local testing guide

APOS is a static Next.js export. There is no database, no account system and no
permanent file storage. Browser tools process documents on your machine.

## Start the site

From the repository root:

```powershell
npm install
npm run build
npm run serve:static
```

Open **http://localhost:3000**.

`npm run build` creates `out/` and runs a postbuild step that normalizes Next.js
prefetch filenames on Windows. `npm run serve:static` serves that directory with
the same security headers used in production.

To stop the server, press `Ctrl+C` in its terminal.

## What to test locally

### 1. Workspace and directory

- Open `/`.
- Use the sidebar to open a studio.
- Open `/tools` and verify all 43 tools appear.
- Search for `passport`, then filter by **PDF Conversion** and by **AI text service**.
- Resize to a 390 px-wide viewport. The header, tool cards and filters should
  not scroll sideways.
- Open `/studios` and `/faq`.

### 2. Core PDF flow

Use any normal PDF with selectable text.

- **Merge PDF**: add two PDFs, reorder them, merge and reopen the download.
- **Split PDF**: split by range, download the ZIP and check the page counts.
- **Rotate / Reorder / Delete / Extract**: confirm the downloaded page order.
- **Compress / Repair / Optimize**: check that the result reports real byte and
  page counts and opens without an error.

### 3. Conversion flow

- **PDF to Markdown** (`/tools/pdf-to-markdown`): choose a text PDF, download the
  `.md`, and confirm headings, paragraphs and tables are present.
- **PDF to Office** (`/tools/pdf-to-office`):
  - Reflowing Word (the default): headings, paragraphs, real tables, fonts, text
    sizes and text colours should be preserved. Check the Word table columns and
    cell styling.
  - Exact positions → Word: text and pictures should stay at their PDF positions.
    Tables are positioned text in this mode; use Reflowing Word for real tables.
  - Excel: detected tables should become worksheets.
  - Visual Word: each page should be an image, not editable text.
  - Try a scanned PDF. The tool should stop with a clear OCR message rather than
    silently producing an empty document.
- **PDF to Text / HTML / Images**: use a page range and confirm only that range
  is exported.

### 4. Privacy and verification

- **Document Passport** (`/tools/document-passport`): upload a PDF, confirm the
  fingerprint, metadata, form/attachment/script warnings and the clean-copy
  download.
- **Verify & Compare**: compare an original PDF with a modified copy and check
  page count, text similarity and visual difference.
- **Fill PDF form**: use a PDF with AcroForm fields, fill a text box and checkbox,
  flatten the result, then reopen the download.

### 5. OCR

- **Image OCR** (`/tools/ocr-image`): use a clear screenshot or scanned image.
- **OCR PDF** (`/tools/ocr-pdf`): use a scanned PDF and check both the searchable
  PDF and the text output. The first OCR run downloads the language model.

### 6. Workflow and editors

- Build a two-step workflow (for example Merge → Compress) and run it on real files.
- Open the document, spreadsheet and presentation editors and export a PDF.

## Expected local-only behaviour

- `/api/v1/tools` returns 404 when the optional FastAPI processing server is not
  running. This is expected; the browser-local tools still work.
- **AI assistant**, **Document summary** and **AI document agent** need a
  configured AI endpoint/key.
- **Server exact layout** in PDF to Office and the tools on `/server-tools` need
  the optional FastAPI service. Browser mode does not upload anything.
- There are no test accounts. The app has no login.

## Automated checks

```powershell
npm run typecheck
npm run lint
npm test
npx playwright test --workers=1
```

To run a browser test against the deployed site instead of localhost:

```powershell
$env:PLAYWRIGHT_BASE_URL = "https://apos.nxtgensec.org"
npx playwright test e2e/pdf-conversion-studio.spec.ts e2e/pdf-office-fidelity.spec.ts -g "PDF to Office|colour|fidelity" --workers=1
Remove-Item Env:PLAYWRIGHT_BASE_URL
```

## Deploy

```powershell
npm run build
npx wrangler deploy
```

Production URLs:

- https://apos.nxtgensec.org
- https://apos.demonxtgensec.workers.dev
