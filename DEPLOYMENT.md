# Audixa — Deployment Guide

## Why the backend was "not working"

Your frontend on Vercel was fine — the Render backend was the problem. The old `main.py` **crashed at boot** if any environment variable (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`) was missing on Render, so the whole service went down and the frontend saw "Cannot reach backend". It also created the FastAPI app twice, and Render's free tier sleeps after 15 minutes of inactivity, making the first request time out.

All three are now fixed in code. You still need to do the Render steps below once.

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
   - `GROQ_API_KEY` — your Groq key
   - `FRONTEND_ORIGINS` — your exact Vercel URL, e.g. `https://your-app.vercel.app` (any `*.vercel.app` origin is also allowed automatically)
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

Run `backend/travel_plans.sql` in the Supabase SQL editor if the `travel_plans` table doesn't exist. Tables needed: `profiles`, `policies`, `expenses`, `claims`, `travel_plans`.

## Free-tier cold starts

Render free tier sleeps after ~15 min idle; the first request takes 30–60 s. The frontend now shows a "server waking up" banner and retries automatically instead of showing a dead error page. To eliminate this entirely, upgrade the Render instance or use a cron ping (e.g. cron-job.org hitting `/health` every 10 min).

## What's new in this version

- Backend never crashes on missing env vars; `/health` reports diagnostics
- Spend Analytics page (compliance rate, category/vendor/month breakdowns) — `GET /analytics/summary`
- CSV export of expenses — `GET /expenses/export.csv`
- "Ask the Policy" AI Q&A on the Policy page — `POST /policy/ask`
- Duplicate receipt detection (same vendor + amount + date auto-flags)
- Delete / detach expenses — `DELETE /expenses/{id}`, `POST /expenses/{id}/detach`
- Non-blocking backend status banner with cold-start auto-retry
- Formal UI: lucide icons throughout (emoji removed), consistent enterprise styling
