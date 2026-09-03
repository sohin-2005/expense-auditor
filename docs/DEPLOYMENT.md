# Audixa — Deployment Guide

## Current status (verified)

- **Render backend — live and healthy.** `GET /health` returns
  `{"status":"ok","supabase_configured":true,"groq_configured":true,"boot_errors":[]}`.
  It only *looks* dead when it has been idle: the free tier sleeps after ~15 min
  and the first request takes 30–60 s to wake it.
- **Vercel frontend — builds cleanly** with the exact commands in `vercel.json`
  (`npm ci` then `vite build`).

## If the deployed site is a blank white page

This is an environment-variable problem, not a build problem, and it has been
made self-diagnosing.

`src/supabase.js` calls `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_KEY)` at
module scope. Supabase throws `supabaseUrl is required.` synchronously when
those are missing — before React ever mounts — so the page rendered as a blank
void with the reason buried in the console. Vercel does **not** read
`frontend/.env` (it is gitignored); those values must be set in the Vercel
dashboard.

Now the app boots regardless and tells you what is missing:

1. A **setup screen** naming the exact missing variables (`main.jsx`).
2. An **error boundary** that shows any render-time crash instead of blanking.
3. A **boot guard** in `index.html` that fires if the JS bundle itself 404s or
   throws at import time — covering the "wrong outputDirectory" class of failure.

So a white screen should now be impossible; you get an actionable message.

## 1. Fix the Render backend (required)

1. Push this repo to GitHub (`git add -A && git commit -m "fix backend" && git push`).
2. In the [Render dashboard](https://dashboard.render.com), open your `expense-auditor-4f7b` service (or create a new Web Service → connect the repo).
3. Settings must be:
   - **Root Directory:** `backend`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Health Check Path:** `/health`
4. Under **Environment**, add:
   - `SUPABASE_URL` — from Supabase → Project Settings → API
   - `SUPABASE_SERVICE_ROLE_KEY` — same page (service_role, **not** anon)
   - `GEMINI_API_KEY` — your Gemini API key. **Required for image receipts** —
     vision (image) tasks go to Gemini only and have no fallback provider. If
     this is unset, `/health` reports `"status": "degraded"` and every image
     receipt upload fails with a 503.
   - `GROQ_API_KEY` — your Groq key. Used as the fallback for text-only tasks
     (receipt text, audits, trip planning); not used for images.
   - `FRONTEND_ORIGINS` — your exact Vercel URL, e.g. `https://your-app.vercel.app` (any `*.vercel.app` origin is also allowed automatically)

   Optional overrides (sensible defaults if unset — see `backend/ai_provider.py`'s `load_config`):
   - `GEMINI_TEXT_MODEL`, `GEMINI_VISION_MODEL` — which Gemini model to call for each task
   - `AI_PRIMARY_PROVIDER` — set to `groq` to try Groq before Gemini for text tasks (default: Gemini first)
   - `GROQ_TEXT_MODEL` — which Groq model to call for text tasks
   - `AI_TIMEOUT_SECONDS`, `AI_RETRIES` — per-request timeout and retry count for AI calls
5. Click **Manual Deploy → Deploy latest commit**, then open `https://expense-auditor-4f7b.onrender.com/health` in your browser.

`/health` now tells you exactly what's wrong. If it shows `"status": "degraded"` with `boot_errors`, an env var is still missing — the service no longer crashes, it tells you instead.

Alternatively: Render → **New → Blueprint** and point it at this repo; `render.yaml` configures everything, you only fill in the env values.

## 2. Fix the Vercel frontend (required)

In Vercel → your project → **Settings → Environment Variables**, add for Production:

- `VITE_API_URL` = `https://expense-auditor-4f7b.onrender.com`
- `VITE_SUPABASE_URL` = your Supabase URL
- `VITE_SUPABASE_KEY` = your Supabase **anon** key

Then **Redeploy** (env vars are baked in at build time — a redeploy is mandatory after changing them).

## 3. Supabase (one-time, if not already done)

Run `backend/db/travel_plans.sql` in the Supabase SQL editor if the `travel_plans` table doesn't exist. Tables needed: `profiles`, `policies`, `expenses`, `claims`, `travel_plans`.

## Free-tier cold starts

Render free tier sleeps after ~15 min idle; the first request takes 30–60 s. The frontend now shows a "server waking up" banner and retries automatically instead of showing a dead error page. To eliminate this entirely, upgrade the Render instance or use a cron ping (e.g. cron-job.org hitting `/health` every 10 min).

## Dependency pinning

`backend/requirements.txt` and the root copy are kept in sync and pinned to
exact versions:

```
fastapi==0.141.1
uvicorn[standard]==0.52.4
python-multipart==0.0.32
python-dotenv==1.2.3
supabase==2.31.0
PyPDF2==3.0.1
pillow==12.3.0
openai==3.7.0
```

Unpinned requirements meant a breaking upstream release could kill a Render
build with no change on your side — the classic "it deployed fine last week"
failure. These versions are verified to install clean and import `main.py`.

## Known limitation: receipt uploads are ephemeral

`backend/uploads/` lives on Render's ephemeral disk, so files written there are
**lost on every restart, redeploy, and cold-start recovery**, and previously
stored receipt images will 404. The audit results in Supabase survive; only the
image files disappear. Fix properly by uploading to Supabase Storage instead of
local disk, or attach a Render persistent disk (paid).

## Troubleshooting quick table

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank white page | `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` unset in Vercel | Set them, then **Redeploy** |
| Setup screen naming variables | Same as above | Set them, then **Redeploy** |
| "Audixa failed to start" + script 404 | Wrong `outputDirectory` | Must be `frontend/dist` |
| "Connecting to server…" banner for ~1 min | Render free-tier cold start | Normal; retries automatically |
| "Cannot reach backend" after retries | `VITE_API_URL` wrong, or service suspended | Check `/health` in a browser |
| CORS error in console | Frontend origin not allowed | Set `FRONTEND_ORIGINS` on Render |
| `/health` returns `degraded` | Backend env var missing (Supabase or **both** `GEMINI_API_KEY`/`GROQ_API_KEY` unset) | Read `boot_errors` in the response |
| Image receipts fail with 503 "Image scanning is temporarily unavailable" | `GEMINI_API_KEY` unset — vision has no fallback provider | Set `GEMINI_API_KEY` on Render |

## What's new in this version

- Backend never crashes on missing env vars; `/health` reports diagnostics
- Spend Analytics page (compliance rate, category/vendor/month breakdowns) — `GET /analytics/summary`
- CSV export of expenses — `GET /expenses/export.csv`
- "Ask the Policy" AI Q&A on the Policy page — `POST /policy/ask`
- Duplicate receipt detection (same vendor + amount + date auto-flags)
- Delete / detach expenses — `DELETE /expenses/{id}`, `POST /expenses/{id}/detach`
- Non-blocking backend status banner with cold-start auto-retry
- Formal UI: lucide icons throughout (emoji removed), consistent enterprise styling
