# APOS — Advanced Professional Office Suite

## 1. Project Vision
Build a premium, professional, online-first office productivity suite with original branding, modular architecture and real working functionality.

Reference websites:
- https://www.ilovepdf.com/
- https://smallpdf.com/
- https://www.adobe.com/acrobat/online.html
- https://tools.pdf24.org/
- https://www.sejda.com/

Use these for functional research. Never copy proprietary code, branding or protected assets.

## 2. Non-Negotiable Requirements
- No application database.
- No PostgreSQL, MySQL, MongoDB or SQLite.
- No mandatory accounts.
- No permanent uploaded-file storage.
- Temporary isolated file processing.
- Automatic temporary-file cleanup.
- Browser-side processing where practical.
- No mandatory cloud storage.
- Online-first development.
- Offline support is a future phase.
- Never advertise unfinished tools as available.
- LocalStorage is allowed for preferences.
- IndexedDB and OPFS may be used for temporary browser processing.

## 3. Technology Stack

Frontend:
- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Lucide icons

Backend:
- Python
- FastAPI
- Pydantic

Processing technologies, introduced when needed:
- PyMuPDF
- pikepdf
- qpdf
- LibreOffice
- Tesseract OCR
- Pillow
- OpenCV
- PDF.js

Testing:
- Pytest
- Playwright
- TypeScript checks

Verify compatibility and licensing before integrating dependencies.

## 4. Fifteen Product Studios

1. PDF Essentials
2. PDF Conversion
3. PDF Editor
4. PDF Organizer and Layout
5. PDF Security and Signature
6. PDF Repair and Optimization
7. Image Studio
8. OCR and Scanning Studio
9. Document Studio
10. Spreadsheet Studio
11. Presentation Studio
12. AI Studio
13. Automation Studio
14. Utility Studio
15. Developer Studio

Define all 15 studios in Phase 1 with stable IDs.

The long-term target is 200+ tools. Add tools progressively. Never fill the catalogue with fake placeholders.

## 5. Tool Registry Requirements

Create one authoritative typed registry.

- Derive StudioId from the canonical studio list.
- Require exhaustive studio coverage using TypeScript mapped types.
- Derive navigation from the authoritative studio definitions.
- Ensure exactly one navigation entry per studio.
- Use runtime schema validation.
- Enforce unique studio IDs and tool IDs.
- Reject references to unknown studios.

Each tool must have exactly one status:

- planned
- in-development
- available
- unavailable

Unavailable tools require an explanation.

At Phase 1 launch, tools must be planned unless there is a concrete verified reason to mark them unavailable.

Never mark a tool available merely because its card or route exists.

## 6. Bulk Conversion Architecture

Bulk conversion is a critical APOS feature.

Plan one reusable batch engine supporting 20+ files, subject to resource limits.

Future conversion formats:
- DOC/DOCX to PDF
- XLS/XLSX to PDF
- PPT/PPTX to PDF
- ODT/ODS/ODP to PDF
- Images to PDF
- PDF to DOCX/XLSX/PPTX
- PDF to JPG/PNG
- Image format conversion
- TXT/RTF/Markdown to PDF
- HTML to PDF

Required batch features:
- Multiple file upload
- Drag and drop
- Mixed-format batches
- Signature-based file detection
- Configurable size and count limits
- Per-file validation
- Batch manifest
- Individual and global settings
- Bounded concurrency
- Per-file progress
- Batch progress summary
- Retry failed files
- Skip unsupported files
- Partial success
- Duplicate filename resolution
- Custom naming
- Output validation
- Individual downloads
- ZIP download
- Human-readable error report
- Automatic cleanup
- Expiring download tokens

Do not claim conversion paths are supported until implemented and tested.

Phase 1 must not expose fake upload or conversion functionality.

## 7. Original APOS Innovations

Plan these future modules:
- APOS File DNA
- APOS Visual Fidelity Engine
- APOS Flow Designer
- APOS Batch Intelligence
- APOS Smart Page Designer
- APOS Document Doctor
- APOS Conversion Lab
- APOS Privacy Guardian
- APOS Document Timeline
- APOS Knowledge Extractor

Validate technical feasibility and market uniqueness before making claims.

## 8. Design System

Create an original premium professional interface.

Requirements:
- Original APOS logo and branding.
- Light and dark themes.
- Responsive layouts.
- Collapsible sidebar.
- Global tool search.
- Searchable directory.
- Reusable tool cards.
- Accessible navigation.
- Keyboard support.
- Consistent loading, empty and error states.
- Professional typography and spacing.
- Original visual design.

## 9. Application Architecture

Use a modular monolith initially.

Separate:
- Frontend application
- Backend API
- Shared types and schemas
- Tool registry
- Processing engines
- Validation
- Security
- Tests
- Documentation

Do not introduce unnecessary microservices.

## 10. API Architecture

Reserve:
GET /api/v1/health
GET /api/v1/tools
POST /api/v1/batches
GET /api/v1/batches/{batch_id}
POST /api/v1/batches/{batch_id}/items/{item_id}/retry
POST /api/v1/batches/{batch_id}/items/{item_id}/skip
GET /api/v1/downloads/{token}
DELETE /api/v1/batches/{batch_id}

Phase 1 should expose only health and an optional read-only registry endpoint.

Do not implement upload or processing endpoints until security, validation and cleanup are ready.

## 11. Database-Free Architecture

- No application database.
- No Redis.
- No persistent job queue.
- No cloud file storage.
- No mandatory authentication.
- Bounded in-memory job tracking.
- Temporary isolated file workspaces.
- Generated random workspace identifiers.
- Expiring download tokens.
- Automatic cleanup.
- LocalStorage for preferences only.

Process restarts may lose active job state. Document this limitation.

## 12. Security

- Validate file signatures.
- Never trust filenames or MIME types alone.
- Enforce upload and decompression limits.
- Restrict CPU, memory and processing time.
- Isolate processing jobs.
- Use unprivileged converter processes.
- Prevent path traversal.
- Never execute uploaded files.
- Validate generated outputs.
- Use expiring download tokens.
- Do not log document contents.
- Clean temporary files on success, failure and cancellation.
- Restrict CORS.
- Apply request throttling.
- Keep processing dependencies patched.

Security must be implemented before file processing is enabled.

## 13. Testing

Add automated tests for:
- Studio completeness.
- One-to-one navigation coverage.
- Runtime registry validation.
- Unique studio and tool IDs.
- Valid tool-to-studio references.
- Status validity.
- Unavailable explanations.
- Search behavior.
- Responsive navigation.
- Accessibility.
- Theme persistence.
- API health.
- Error handling.

Later processing tests must cover:
- File validation.
- Batch scheduling.
- Bounded concurrency.
- Retry and skip.
- Duplicate filenames.
- Partial failures.
- Output validation.
- Cleanup.
- Download expiration.
- Conversion regression fixtures.

Never claim tests passed unless they were actually executed.

## 14. Development Roadmap

Phase 1: Foundation, branding, dashboard and registry.
Phase 2: PDF Essentials.
Phase 3: Conversion and Bulk Conversion.
Phase 4: Professional PDF Editor.
Phase 5: Office Studio.
Phase 6: OCR and AI Studio.
Phase 7: APOS innovations.
Phase 8: Automation Studio.
Phase 9: Security, testing and deployment.
Phase 10: Future offline edition.

## 15. Current Assignment — Phase 1

The user has explicitly approved Phase 1 implementation.

First verify this file and inspect the repository.

Then implement incrementally:
1. Project structure and dependency manifests.
2. Original APOS branding and design system.
3. All 15 studios and exhaustive registry.
4. Runtime schema validation and automated tests.
5. Responsive dashboard and navigation.
6. Searchable tool directory.
7. FastAPI health endpoint.
8. Documentation and verification.

Run tests, TypeScript checks and production builds.

Do not implement fake processing functionality.
Do not introduce a database.
Do not skip security or testing.

Report:
- Completed work
- Modified files
- Dependencies
- Commands to run
- Actual test results
- Remaining issues

Follow the approved architecture. Ask before introducing any major architectural deviation.
