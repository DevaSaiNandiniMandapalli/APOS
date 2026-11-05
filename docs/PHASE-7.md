# Phase 7 — CI, supply chain & hardening

Status: **Complete (verified)** · Branch: `lemon/design-and-build`

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests, on pushes to non-`master`
branches, and on demand. Least-privilege `contents: read`; concurrency cancels
superseded runs.

- **Web job** (Node 20, npm cache): `npm ci` → `typecheck` → `lint` → `test` →
  `build` → `npm audit --omit=dev --audit-level=critical`.
- **API job** (Python 3.11, pip cache): `pip install -e ".[test]"` →
  `pytest`.

`master` is intentionally excluded from push triggers (work lands via PR).

## Dependency updates

`.github/dependabot.yml`: weekly updates for npm, pip (`/backend`) and
GitHub Actions, capped at 5 open PRs each; npm minor/patch updates are grouped.

## Security headers

`next.config.ts` now sends, for every route:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Cross-Origin-Opener-Policy: same-origin`

Also `poweredByHeader: false` (no `X-Powered-By`).

## Secrets & dependency review

- `git ls-files` contains no `.env`, key, PEM or credential files; `.env` and
  `.env.*` are ignored, `.env.example` holds placeholders only.
- Tracked files and full git history were searched for literal key patterns
  (hash/filename output only): **no matches**.
- `npm audit --omit=dev` — **0 vulnerabilities**.
- License review: `docs/LICENSE-REVIEW.md` — all runtime licenses permissive
  (MIT / ISC / Apache-2.0), no GPL/AGPL. Apache-2.0 packages keep their NOTICE.
- `SECURITY.md` documents private reporting and the scope.

## Verification (actual)
- YAML parsed successfully for both `.github` files.
- Headers confirmed on a live response (`X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`).
- `POST /api/ai` without a key returns `503` (no crash, no leakage).
- Full app verification: typecheck/lint 0 errors, 202 unit tests, 3 backend
  tests, production build, 86/86 Playwright tests.

## Further recommendations (not implemented)
- A strict `Content-Security-Policy` is deferred because the app relies on
  Next.js inline bootstrap scripts, pdf.js workers and the Tesseract CDN; it
  needs nonce wiring and a worker/blob allowlist.
- Enable GitHub secret scanning and branch protection for `master` in repo
  settings (server-side, not code).

## CI activation note

The GitHub login currently connected to this workspace has the `repo` and
`gist` scopes but not `workflow`, so GitHub rejects creating
`.github/workflows/ci.yml` (it answers 404). The exact workflow is preserved in
`docs/ci-workflow.yml`. To activate it: either re-authorize GitHub with the
`workflow` scope, or in the GitHub web UI add a file at
`.github/workflows/ci.yml` by pasting that content, then delete the docs copy.
