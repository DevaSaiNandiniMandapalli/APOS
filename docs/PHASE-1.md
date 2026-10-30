# Phase 1 foundation

## Delivered

- Original APOS identity and responsive light/dark dashboard.
- Fifteen stable studio IDs, one authoritative typed tool registry, exhaustive `StudioId`, and navigation derived from studio definitions.
- Runtime schema validation for unique identifiers, known studio references, valid status values, and unavailable explanations.
- Search across tool name, description, and studio name. Keyboard shortcut `Ctrl/⌘+K` focuses search; Escape closes the mobile navigation.
- FastAPI `GET /api/v1/health` endpoint.

## Deliberate limits

All catalog entries are marked `planned`. There are no upload controls or claims of supported conversions. Phase 1 has no database or file storage. The API has no batch, upload, processing, or download endpoints.

The broader processing design remains a future implementation: bounded, isolated temporary workspaces, signature validation, resource limits, cleanup, and expiring downloads must be in place before processing routes are added. If future in-memory jobs are used, process restarts can discard active state.

## 100% functionality audit

The permanent APOS requirement is **100% functionality — no dead buttons, no fake features**. Phase 1 controls were reviewed against that requirement:

- Theme toggle and sidebar collapse persist preferences in LocalStorage. Responsive navigation opens, selects a studio filter, and closes with Escape. Browser tests cover these behaviors.
- Studio navigation entries and the six featured studio cards select the corresponding registry filter. They do not open dedicated studio routes yet.
- Search returns matching registry entries, but the planned tool cards are not links and do not navigate to tool pages. Tool implementation and routing are intentionally not implied by the `Planned` status.
- **“View all studios” is misleading:** it expands the tool list; it does not reveal the other nine studio cards. **“Explore the studios” also expands the tool list**, not a studio directory.
- “Browse the full directory” expands the complete tool list and does what its label says. “Clear search” clears the query and studio filter. The APOS logo links to the page top.

The first two label/directory mismatches and the missing studio/tool routes are recorded as Phase 2 entry work. No control should be presented as a completed tool action before its real route and behavior exist.

## Next phases

Implement PDF Essentials only after the processing security design and validation/cleanup behavior are ready. Add conversion paths individually after implementation and tests verify them. The 20+ file batch engine and APOS innovation modules remain roadmap items and are not presented as available features.
