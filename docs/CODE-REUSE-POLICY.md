# Code reuse policy

APOS is MIT-licensed and should stay redistributable under MIT for the browser
application.

## Allowed

- MIT, ISC, BSD-2/3-Clause and Apache-2.0 libraries or snippets.
- Reusing an algorithm, data format or architectural idea with an original
  implementation.
- Copying a small utility function from a permissively licensed project when
  the copyright notice is retained in `THIRD-PARTY-NOTICES.md` or the source
  header.
- Apache-2.0 components with their NOTICE file preserved.

## Not allowed

- Copying source, copy, assets, icons, fonts or branding from iLovePDF,
  Smallpdf, Adobe Acrobat, PDF24, Sejda or another proprietary product. Those
  are reference products, not source donors.
- Adding GPL/AGPL code to `src/`, `worker/` or other MIT-licensed source
  without an explicit decision to relicense the affected distribution.
- Removing license headers, copyright notices or NOTICE files.
- Shipping a container image containing Ghostscript or PyMuPDF without
  reviewing their AGPL/commercial terms.
- Copying a UI pixel-for-pixel. Recreate the user outcome with APOS's own
  design system.

## Before adding a dependency

1. Check its license from the installed package metadata, not only the README.
2. Check transitive dependencies; a permissive package can pull in a
   copyleft engine.
3. Record the license in `THIRD-PARTY-NOTICES.md`.
4. Keep native/browser code separate if the license differs.
5. Run `npm audit` and `pip-audit` before release.

## Current known licensing risks

- `pdf2docx` is MIT but depends on `PyMuPDF` (AGPL-3.0/commercial).
- The server Docker image installs Ghostscript (AGPL-3.0/commercial).
- `pikepdf` and `ocrmypdf` are MPL-2.0 dependencies.

These are optional self-hosted server components. The browser application does
not bundle them. A commercial distribution that includes them should obtain
appropriate licenses or isolate/replace them.

## Product features vs code copying

Using a competitor to understand what users need is fine. Copying its code or
protected UI is not. If an MIT project already solves a feature well, reuse it
with attribution; otherwise build an original implementation.
