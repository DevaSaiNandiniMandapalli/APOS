# Deploying APOS

APOS is a **static Next.js export** (`output: "export"`). The production web app
is served from `out/`; `next start` is not used. The optional FastAPI service is
deployed separately.

## Option A — Cloudflare (the current production path, recommended)

1. Build:
   ```powershell
   npm ci
   npm run build
   ```
2. Deploy:
   ```powershell
   npx wrangler deploy
   ```
3. Set `SARVAM_API_KEY` as a Cloudflare Worker secret for `/api/ai`:
   ```powershell
   npx wrangler secret put SARVAM_API_KEY
   ```
4. The Worker reads `worker/index.ts`; static assets come from `out/`. The CSP
   and security headers are in `public/_headers` and are copied into `out/`.

### Optional processing server

Deploy `backend/` separately and build the site with a **stable** URL:

```powershell
$env:NEXT_PUBLIC_APOS_API_URL="https://api.example.com"
npm run build
powershell -ExecutionPolicy Bypass -File scripts/patch-headers.mjs
npx wrangler deploy
```

Do not bake a Cloudflare quick tunnel (`*.trycloudflare.com`) into a production
build. Quick tunnels are temporary and can disappear or be reissued.

## Option B — Vercel

Vercel can serve a static export:

1. Framework preset: **Next.js**
2. Build command: `npm run build`
3. Output directory: `out`
4. Add `NEXT_PUBLIC_APOS_API_URL` only if a stable processing server exists.

Vercel does not run `worker/index.ts`. If you need AI, host the AI proxy
separately (or use the Cloudflare deployment) and point the frontend at it. The
`public/_headers` file is a Cloudflare/Netlify convention; add equivalent
headers in Vercel if you deploy there.

## Option C — Netlify

1. Build command: `npm run build`
2. Publish directory: `out`
3. Do **not** use the Next.js runtime plugin with `output: "export"`.

`public/_headers` is copied into `out/` and Netlify honors it.

## Option D — Render (static site)

Use a **Static Site**, not a Web Service:

- Build: `npm ci && npm run build`
- Publish: `out`
- Do not use `npm run start`; the project is a static export.

The FastAPI service has a separate blueprint in `render.yaml`. The free 512 MB
plan is not suitable for LibreOffice conversions; use a larger instance or the
full Docker image on a host with at least 1 GB.

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `SARVAM_API_KEY` | Cloudflare Worker secret | Server-only AI key. Never expose it in the client. |
| `SARVAM_API_URL` / `SARVAM_MODEL` | Worker environment | Optional AI endpoint/model overrides. |
| `NEXT_PUBLIC_APOS_API_URL` | Build time | Stable processing-server origin. |
| `NEXT_PUBLIC_SITE_URL` | Build time | Canonical site URL for metadata/sitemap. |
| `CORS_ORIGINS` | FastAPI | Allowed browser origins for the processing API. |

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e -- --workers=1
backend/.venv/Scripts/python.exe -m pytest backend/tests
```

Check the deployed response headers:

```powershell
curl.exe -I https://your-site.example/
```

You should see `Content-Security-Policy`, `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy` and HSTS. If you deploy somewhere that
ignores `_headers`, configure those headers in that platform.
