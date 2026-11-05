# Deploying APOS (permanent URL)

The app is a standard Next.js 16 app. No database or storage is required: all
document processing happens in the browser.

## Option A — Vercel (recommended, free)

1. Sign in at https://vercel.com with the GitHub account that owns the repo.
2. **Add New → Project → Import Git Repository** and choose
   `DevaSaiNandiniMandapalli/APOS`.
3. Set **Branch** to `lemon/design-and-build` (or merge it to `master` first).
4. Framework preset: **Next.js** · Root directory: `.` · Build command:
   `npm run build` · Install: `npm ci` (defaults are fine).
5. Environment variables (optional):
   - `SARVAM_API_KEY` — enables the AI assistant (server-side only).
   - `SARVAM_API_URL`, `SARVAM_MODEL` — only if you need overrides.
6. **Deploy**. Your URL will be `https://<project>.vercel.app`.

Every later push to that branch produces a new preview deployment.

## Option B — Netlify

1. https://app.netlify.com → **Add new site → Import an existing project**.
2. Pick the repo and branch `lemon/design-and-build`.
3. Build command `npm run build`; the Netlify Next.js runtime is detected
   automatically. Publish directory `.next`.
4. Add the same environment variables, then deploy.

## Option C — Render

1. https://dashboard.render.com → **New → Web Service** → connect the repo.
2. Environment: Node. Build: `npm ci && npm run build`.
   Start: `npm run start -- -p $PORT`.
3. Add environment variables and deploy.

## Option D — Temporary preview (what is running now)

A Cloudflare quick tunnel exposes the workspace server:

```
cloudflared tunnel --url http://localhost:3000 --protocol http2
```

It only lives while the workspace server runs, so use it for review, not as a
permanent address.

## Notes

- The FastAPI backend under `backend/` is not needed by the web app; deploy it
  separately only if you extend the API.
- Never commit `SARVAM_API_KEY`; set it in the host's environment settings.
- CI (`docs/ci-workflow.yml`) requires the GitHub `workflow` scope to be
  activated.
