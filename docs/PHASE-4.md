# Phase 4 — PDF Editor & Document Studio

Status: **Complete (core verified)** · Branch: `lemon/design-and-build`

## Delivered in this phase

### Build & runtime recovery
- Resolved duplicate `pendingLinkActionRef` / `pendingImageActionRef` declarations
  (TS2451) by keeping a single typed `useRef` of each.
- Implemented the missing `LexicalEditorCommands` component inside the
  `LexicalComposer` tree (registers the editor via `onEditorReady` and drains
  queued link/image actions). Removed the dead `LexicalEditorCommandsWrapper`.
- Registered the Lexical nodes required by the mounted plugins
  (`ListNode`, `ListItemNode`, `LinkNode`, `TableNode`, `TableCellNode`,
  `TableRowNode`). Without these, `ListPlugin` threw at hydration and the route
  crashed with "This page couldn't load".
- Fixed the RichText surface: `RichTextPlugin.contentEditable` now receives
  Lexical's `<ContentEditable>` component (a raw `<div>` is never editable).

### Route isolation (P4-05)
- New `src/components/tool-renderer.tsx`:
  - each tool is code-split via `next/dynamic` (`ssr: false`);
  - every tool is wrapped in a `ToolErrorBoundary`, so a failure in one tool no
    longer 500s every `/tools/*` route;
  - the 33-way ternary in `src/app/tools/[toolId]/page.tsx` is replaced by a
    clean registry map.

### Tests (P4-06)
- New `e2e/document-editor.spec.ts` (4 tests):
  - renders editor, toolbar, page settings, Export/Reopen controls;
  - typing updates the document and autosaves ("Saved locally");
  - link dialog inserts a real `<a href>`;
  - table insertion renders a real `<table>` with rows.

### Design system (reference-aligned)
- Adopted the reference suite's look: **Inter** font and red accent.
- `--purple` accent token remapped to brand red `#d42924` (meets WCAG AA 4.5:1
  at small text); brand mark / hero gradient / icons retinted to red.
- Fonts loaded in `src/app/layout.tsx` via Google Fonts (Inter 400–800).

## Verification (actual)
- `npm run typecheck` — pass (0 errors)
- `npm run lint` — pass (0 errors; 18 pre-existing warnings)
- `npm test` — 170/170
- backend `pytest` — 3/3
- `npm run build` — pass (52 static routes)
- Playwright full suite — **72/72 pass** (dashboard 52 + image-converter 16 + document-editor 4)

## Known remaining verification (not blocking)
- Export-PDF (worker flatten) and Reopen (`.apos.json`) paths are implemented and
  unit-covered at the model level but are **not yet covered by an E2E download
  test**. Image insertion is E2E-adjacent (dialog verified) but not yet asserted
  end-to-end with a fixture image.
- Registry statuses for `document-editor` and `edit-pdf` remain
  `in-development` until those last paths are E2E-verified, to keep status labels
  honest.

## Next phase
Phase 5 — Spreadsheet Studio and Presentation Studio.
