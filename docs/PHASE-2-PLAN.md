# Phase 2 plan — PDF Essentials

## Goal

Deliver the first genuinely useful APOS tools in PDF Essentials while preserving the database-free, account-free, temporary-processing architecture. No tool becomes `available` until its operation, failure paths, responsive UI, accessibility, and automated tests pass.

## Entry audit and navigation foundation

Resolve the Phase 1 audit findings before adding PDF operations:

1. Replace the misleading “View all studios” action with a real all-studio directory, or change its label to describe the tool list it currently reveals.
2. Make “Explore the studios” open the studio directory it advertises, or rename it to describe the action.
3. Add meaningful studio routes for all 15 stable studio IDs. Each route must show studio purpose, its registry tools and honest statuses. Non-PDF tools remain Planned; their pages must not imply they work.
4. Make global and studio-filtered search results navigate to the corresponding tool route. Planned tool routes must say Planned and contain no fake processing form.
5. Preserve and test theme preference, sidebar collapse, mobile navigation, keyboard search, Escape behavior, and accessible names after route changes.

## Scope and sequence

Build one vertical slice at a time. Proposed first operations are:

1. **Merge PDF** — accept multiple valid PDFs, preserve user-selected order, produce one validated PDF, and offer a real download.
2. **Split PDF** — accept page ranges or one-page-per-file output, validate every output, and download the actual files.
3. **Rotate PDF** — preview/select pages and rotation, then produce and validate the resulting PDF.
4. **Compress PDF** — only after a tested implementation can demonstrate size reduction without claiming a quality level it cannot guarantee. Present measurable input/output sizes and report when a file cannot be reduced.

This is a proposed order, not a claim that these tools are already implemented. Add each tool to the registry only when its scope and route are ready; keep it Planned or In Development until release gates pass.

## Processing and privacy design gate

Before enabling any file input:

- Select a PDF engine after checking current browser/server compatibility, license terms, maintenance, and supported operations. Do not add a dependency based on its name or a card mockup.
- Prefer browser-local processing for these initial operations if the chosen engine meets memory, performance, and output-validation requirements. Do not upload files to a server merely to simplify the UI.
- Validate the PDF signature and parseability; never trust extensions or MIME types. Define and enforce file count, byte-size, page-count, and resource limits with clear per-file errors.
- Keep content in transient memory or an isolated temporary workspace. Do not write document contents to LocalStorage, analytics, logs, or permanent storage. Revoke object URLs and release buffers on success, failure, cancellation, navigation, and unmount.
- Use a worker or equivalent isolation strategy where supported. Cancellation must stop real work and clean up; progress must report measured stages or remain indeterminate, never simulate a percentage.
- Validate generated PDFs by reopening/parsing them and checking expected page counts and metadata. Do not display success or expose a download until validation succeeds.
- If server-side processing is chosen later, first implement isolated random workspaces, unprivileged workers, resource/time limits, bounded concurrency, throttling, restricted CORS, expiring download tokens, and automatic cleanup. No persistent job queue or database.

## Shared tool experience

Each implemented tool page should include:

- A concise explanation of the operation and supported input/output behavior.
- Accessible browse and drag-and-drop input where appropriate, real validation feedback, and keyboard operation.
- Individual file status, actual progress or indeterminate processing state, cancellation where safe, actionable errors, and success feedback tied to validated output.
- A real download with a safe, resolved filename. No dummy output, fake conversion progress, or success toast before output validation.
- Responsive layout, loading/empty/error/success states, and preference-free operation unless a setting has a clear persistent purpose.

## Required test coverage

### Navigation and UI

- All 15 studio routes resolve to the matching stable ID and display the right tools/statuses.
- Search across names, descriptions, and studios returns registry-backed results and each result opens its correct tool page.
- Every button, link, card, menu, toggle, clear action, and browser back/forward transition has an asserted outcome.
- Desktop and mobile viewport coverage; keyboard-only use; automated accessibility checks in light/dark themes; persistent theme/sidebar preferences.
- No dead links, missing routes, misleading labels, inert controls, or available statuses without a verified operation.

### PDF operations

- Valid files, wrong signatures, corrupt PDFs, empty files, size/page/count limits, duplicate filenames, and unsupported inputs.
- Correct operation outputs using fixtures; page order/orientation/range semantics; output parseability and integrity.
- Cancellation and failure cleanup, memory/object URL release, retry behavior if the operation supports retry, and errors that do not leak document contents.
- Download contents and names match the validated output. Success appears only after validation.
- Browser tests on supported desktop and mobile sizes; keyboard and screen-reader semantics.

## Phase 2 completion gate

Complete the full UI dead-control audit from Section 16 of `AGENTS.md`; run registry/unit, API, Playwright, accessibility, TypeScript, lint, and production-build checks; verify supported tool operations with real fixtures; inspect dependency compatibility and licenses; run the dependency audit. Report exact results. Any tool whose implementation or tests are incomplete remains Planned or In Development.

## Out of scope for this phase

Bulk conversion orchestration, 20+ file mixed-format batches, Office conversions, OCR, AI, accounts, databases, cloud storage, permanent uploads, and offline support. Do not expose their controls as functional in Phase 2.
