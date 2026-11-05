# Phase 5 — Spreadsheet Studio & Presentation Studio

Status: **Complete (verified)** · Branch: `lemon/design-and-build`

## Spreadsheet Studio (`/tools/spreadsheet-editor`)

New browser-local spreadsheet with a real formula engine.

- **Grid editor** — 20×8 default grid, editable cells, row/column headers, sticky
  headers, selected-cell outline, add row / add column (up to 200×26).
- **Formula engine** (`src/lib/spreadsheet.ts`, pure & unit-tested):
  - arithmetic `+ − × ÷ ^` with precedence and parentheses;
  - cell references (`=A1+B2*2`), ranges (`A1:A5`);
  - functions: `SUM`, `AVERAGE`/`AVG`, `MIN`, `MAX`, `COUNT`;
  - recursive resolution with cycle detection (`#CYCLE`) and error reporting
    (`#ERROR`);
  - formula bar shows the raw expression plus the computed result.
- **CSV** — export the visible sheet to `spreadsheet.csv`; import a CSV (quoted
  fields, commas, newlines) and auto-grow the grid.
- Everything runs in the browser; no upload.

## Presentation Studio (`/tools/presentation-editor`)

New slide deck editor with present mode and PDF export.

- **Deck model** (`src/lib/presentation.ts`, pure & unit-tested): slides with
  title/body/layout, add / duplicate / delete (never deletes the last slide) /
  move up/down, theme selection, serialized JSON round-trip with validation.
- **Editor** — slide list with thumbnails, live 16:9 canvas, title input, body
  textarea, layout switch (title / title+body / section), 5 themes.
- **Present mode** — full-screen overlay, arrow keys / space / click to advance,
  Escape to exit.
- **Export** — real PDF via `@cantoo/pdf-lib`: one 960×540 page per slide, theme
  background, accent bar, wrapped title and body text. Also Save/Open deck JSON.

## Registration
- New registry tools: `spreadsheet-editor` and `presentation-editor`, both
  `available`, in their respective studios.
- Wired into `src/components/tool-renderer.tsx` (code-split, error-isolated).
- Styles added to `src/app/globals.css`.

## Verification (actual)
- `npm run typecheck` — pass (0 errors)
- `npm run lint` — pass (0 errors; 18 pre-existing warnings)
- `npm test` — **185/185** (24 files; +15 new for Phase 5)
- backend `pytest` — 3/3
- `npm run build` — pass
- Playwright full suite — **79/79 pass**, including:
  - `e2e/spreadsheet-studio.spec.ts` (3): live arithmetic/ref/range formulas,
    CSV export download + CSV import, add row/column.
  - `e2e/presentation-studio.spec.ts` (4): title/body editing, add/duplicate/
    delete slides, theme switch + present mode, PDF download.
  - per-tool axe accessibility checks (no violations).

## Notes
- Spreadsheet values are numbers; text cells are displayed as entered and count
  as 0 in numeric aggregates.
- Deck PDF export uses standard PDF fonts (Helvetica), so glyph support is
  Latin-1; non-Latin characters may not render in the exported PDF (screen
  editing is unaffected).
