# Audixa — Policy-First Expense Auditor

Audixa turns a company expense policy (a PDF) into an enforcement engine. Employees
upload a receipt; the backend OCRs it, audits it against that policy, and returns an
explainable decision — **Approved**, **Flagged**, or **Rejected** — with the reason and
the policy snippet that justified it. A pre-trip planner applies the same policy
*before* money is spent.

**Stack:** React 19 + Vite (Vercel) · FastAPI + Python 3.11 (Render) · Supabase
(PostgreSQL + Auth) · Gemini with Groq fallback.

---

## Table of contents

- [Why it exists](#why-it-exists)
- [Features](#features)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Database schema](#database-schema)
- [API reference](#api-reference)
- [The AI provider layer](#the-ai-provider-layer)
- [Frontend guide](#frontend-guide)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Further reading](#further-reading)

---

## Why it exists

Most expense workflows are reactive: employees spend first, finance discovers the
policy violation weeks later during reimbursement review. That produces delays,
rework, rejected claims, and no visibility for either side.

Audixa moves the policy check to the two moments where it can still change an
outcome:

1. **At capture** — the receipt is audited the second it is uploaded.
2. **Before the trip** — the planner scores an itinerary for compliance while the
   employee is still choosing flights and hotels.

Every decision carries a `reason` and a `policy_snippet`, so no verdict is a black box.

---

## Features

| Feature | How it works | Endpoint |
| --- | --- | --- |
| **Receipt OCR** | Image or PDF → structured fields (merchant, date, amount, currency, category). Images go to a vision model; PDFs are text-extracted with PyPDF2 first, which is faster and cheaper. | `POST /extract-receipt` |
| **Policy audit** | Relevant policy sections + the expense payload → a JSON verdict with reason, policy snippet, and risk level. | `POST /expenses`, `POST /extract-receipt` |
| **Claim lifecycle** | Draft → Submitted → Approved / Flagged / Rejected, with manager and finance override. Claim totals and status stay in sync as expenses attach and detach. | `POST /claims`, `/claims/{id}/submit`, `/claims/{id}/override` |
| **Duplicate detection** | Same vendor + amount + date by the same employee auto-flags as a probable duplicate and links the original. | built into expense creation |
| **Trip planner** | Destination, dates, purpose and planned activities → transport guidance, lodging caps, per-diem limits, compliance risks, an approval-likelihood score, and prompts asking the employee to justify premium choices. Saved for later cross-reference. | `POST /trip-plans/generate` |
| **Ask the Policy** | Free-text Q&A grounded in the uploaded policy text. | `POST /policy/ask` |
| **Spend analytics** | Compliance rate plus category, vendor and month breakdowns. Scoped to the user, or company-wide for finance. | `GET /analytics/summary` |
| **CSV export** | The caller's own expenses, newest first, as a downloadable CSV. | `GET /expenses/export.csv` |
| **Notifications** | Status changes on claims and receipts, surfaced in-app. | derived from claims/expenses |
| **Self-diagnosing health** | `/health` reports Supabase status, the active provider chain, model-catalog drift, and boot errors. | `GET /health` |

### Roles

Set at signup and stored on the `profiles` row. `manager` and `finance` are treated
identically by the UI gate (`isFinance` in `App.jsx`) — both additionally see the
**Approvals** and **Finance Dashboard** pages, and company-wide analytics.

- `employee` — submit expenses and claims, plan trips, view own analytics.
- `manager` / `finance` — the above, plus approvals, claim overrides, the finance
  dashboard, and `scope=all` analytics.

---

## Architecture

```
                       ┌──────────────────────────────────┐
   Browser ──────────► │  React 19 + Vite  (Vercel)       │
                       │  src/App.jsx — pages & state     │
                       │  src/supabase.js — auth session  │
                       └───────┬──────────────────┬───────┘
                               │ Bearer JWT       │ email/password
                               ▼                  ▼
                  ┌────────────────────┐   ┌──────────────────┐
                  │ FastAPI  (Render)  │   │ Supabase Auth    │
                  │ backend/main.py    │   └──────────────────┘
                  │  • routes + audit  │
                  │  • policy cache    │──►┌──────────────────┐
                  │  • claim sync      │   │ Supabase Postgres│
                  └─────────┬──────────┘   │ profiles/claims/ │
                            │              │ expenses/…       │
                            ▼              └──────────────────┘
                  ┌────────────────────┐
                  │ backend/           │  task = "text"  → Gemini → Groq
                  │   ai_provider.py   │  task = "vision"→ Gemini (no fallback)
                  └────────────────────┘
```

**Request flow for a receipt upload:**

1. The browser sends the file with the Supabase access token as `Authorization: Bearer …`.
2. `get_current_user()` validates the token against Supabase and yields the user.
3. The file is written to `backend/uploads/` and served back at `/uploads/<uuid>.<ext>`.
4. PDFs are text-extracted locally; images are base64'd for the vision model.
5. `get_policy()` fetches the company policy (cached 5 minutes) and
   `get_policy_context()` trims it to the sections keyword-relevant to this receipt.
6. `call_ai_json()` runs OCR, then a second call runs the policy audit.
7. `resolve_expense_status()` normalizes the verdict, `apply_duplicate_check()` looks
   for a prior identical expense, and the row is inserted.
8. If the expense belongs to a claim, `sync_claim_status_totals()` recomputes the
   claim's total and status.

**Design decisions worth knowing:**

- **Boot never crashes on bad config.** Missing env vars are collected into
  `BOOT_ERRORS` and reported by `/health` as `"degraded"`, instead of killing the
  process and leaving the frontend with an unexplained "cannot reach backend".
- **Schema-drift tolerance.** `insert_*_with_schema_fallback()` retries an insert
  without a column Postgres says doesn't exist, so a Supabase table missing an
  optional column degrades instead of 500-ing.
- **Policy retrieval is keyword-first, not vector-based.** Context is trimmed to
  ~12 KB (fast mode) before every call — smaller prompts are faster, cheaper, and
  measurably more reliable than pushing the whole policy each time.
- **The claims table is authoritative for status.** Expense-derived status is a
  helper signal, never a hard overwrite of a manual manager decision.

---

## Repository layout

```
expense-auditor/
├── README.md                    ← you are here
├── .gitignore                   secrets, venvs, node_modules, uploads
├── render.yaml                  Render Blueprint for the backend
├── vercel.json                  Vercel build config for the frontend
├── requirements.txt             root mirror of backend/requirements.txt, kept in
│                                sync so a root-dir deploy also builds
│
├── backend/                     FastAPI service
│   ├── main.py                  all routes, auditing, claim lifecycle (~1.7k lines)
│   ├── ai_provider.py           provider-agnostic JSON completions + fallback chain
│   ├── requirements.txt         pinned, exact versions
│   ├── pytest.ini               testpaths = tests
│   ├── Procfile                 uvicorn start command
│   ├── .env.example             template — copy to backend/.env
│   ├── db/
│   │   └── travel_plans.sql     schema for the trip-planning table
│   ├── tests/
│   │   ├── test_ai_provider.py       31 tests — chains, fallback, parsing, config
│   │   ├── test_startup.py            3 tests — catalog check never blocks boot
│   │   └── test_extract_receipt_errors.py   3 tests — error-handler contract
│   └── uploads/                 runtime receipt storage (gitignored, ephemeral)
│
├── frontend/                    React + Vite SPA
│   ├── index.html               boot guard that reports a failed JS bundle
│   ├── package.json
│   ├── vite.config.js
│   ├── .env.example             template — copy to frontend/.env
│   ├── public/audixa-logo.png
│   └── src/
│       ├── main.jsx             root render, setup notice, error boundary
│       ├── App.jsx              every page and component (~3.5k lines)
│       ├── supabase.js          client, session persistence, config guards
│       └── index.css
│
└── docs/
    ├── APPROACH.md              problem framing and design rationale
    ├── DEPLOYMENT.md            step-by-step Render + Vercel deployment
    └── superpowers/             implementation plans and specs
```

Not in git, present locally: `backend/venv/`, `frontend/node_modules/`,
`backend/uploads/*`, and every `.env`. All are regenerated by the setup steps below.

---

## Quick start

**Prerequisites:** Python 3.11+, Node 18+, a Supabase project, a Gemini API key
(and optionally a Groq key).

### 1. Clone

```bash
git clone https://github.com/sohin-2005/expense-auditor.git
cd expense-auditor
```

### 2. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env              # then fill in the values
```

Fill in `backend/.env` — at minimum `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
and `GEMINI_API_KEY`. Then run:

```bash
python -m uvicorn main:app --reload --app-dir .
```

Backend: <http://127.0.0.1:8000> · interactive API docs: <http://127.0.0.1:8000/docs>

Verify the configuration before moving on:

```bash
curl -s http://127.0.0.1:8000/health
```

`"status": "ok"` with an empty `boot_errors` means you are set. `"degraded"` names
exactly which variable is missing.

### 3. Database

In the Supabase SQL editor, run [`backend/db/travel_plans.sql`](backend/db/travel_plans.sql).
Then create the `profiles`, `policies`, `expenses` and `claims` tables — columns are
listed in [Database schema](#database-schema) below.

### 4. Frontend

In a second terminal:

```bash
cd frontend
npm install
cp .env.example .env              # then fill in the values
npm run dev
```

Frontend: <http://localhost:5173>

### 5. First run

1. Sign up — pick a role; choose `finance` to see every page.
2. Go to **Company Policy** and upload a text-based policy PDF (scanned-image PDFs
   have no extractable text and are rejected with a clear message).
3. Go to **Expense Claims → New Claim**, then upload a receipt.

Without a policy uploaded, audits still run but have nothing to enforce against.

---

## Environment variables

### Backend (`backend/.env`, or Render → Environment)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SUPABASE_URL` | **yes** | — | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | — | Service-role key. Bypasses RLS — server-side only, never in the frontend. |
| `GEMINI_API_KEY` | **yes** | — | Vision + primary text provider. Without it, image receipts 503; vision has no fallback. |
| `GROQ_API_KEY` | no | — | Fallback for **text** tasks only. Strongly recommended. |
| `FRONTEND_ORIGINS` | prod | — | Comma-separated extra CORS origins. `localhost:5173` and `https://*.vercel.app` are always allowed. |
| `EXPENSE_AUDIT_FAST_MODE` | no | `1` | Smaller policy context (12 KB vs 18 KB) and fewer PDF pages (8 vs 20). |
| `GEMINI_TEXT_MODEL` | no | `gemini-3.5-flash` | Text model. |
| `GEMINI_VISION_MODEL` | no | `gemini-3.5-flash` | Vision model. |
| `GROQ_TEXT_MODEL` | no | `qwen/qwen3.8-27b` | Groq text model. |
| `AI_PRIMARY_PROVIDER` | no | `gemini` | Set to `groq` to reverse the text chain order. |
| `AI_TIMEOUT_SECONDS` | no | `45.0` | Per-request AI timeout. Vision measures at 10–12 s with 29 s outliers. |
| `AI_RETRIES` | no | `1` | Retries per provider before falling through to the next. |

A malformed `AI_TIMEOUT_SECONDS` or `AI_RETRIES` falls back to its default with a
logged warning rather than crashing at import time.

### Frontend (`frontend/.env`, or Vercel → Environment Variables)

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | yes | Backend base URL, no trailing slash. Falls back to `http://127.0.0.1:8000` on localhost. |
| `VITE_SUPABASE_URL` | yes | Supabase project URL. |
| `VITE_SUPABASE_KEY` | yes | Supabase **anon** key. Never the service-role key — every `VITE_*` value is inlined into the public JS bundle. |

> Vite inlines `VITE_*` at **build** time. After changing these in Vercel you must
> **redeploy**; restarting is not enough.

---

## Database schema

Supabase PostgreSQL. `travel_plans` ships as SQL; the other four tables are listed
here as the API uses them.

**`profiles`** — one row per user, `id` matching `auth.users.id`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, PK | Supabase auth user id. |
| `full_name` | text | Shown throughout the UI. |
| `role` | text | `employee` \| `manager` \| `finance`. |
| `company_id` | text | Scopes policy and analytics. Defaults to `default`. |

**`policies`** — one row per company, upserted on `company_id`.

| Column | Type | Notes |
| --- | --- | --- |
| `company_id` | text, PK | |
| `policy_text` | text | Full extracted PDF text. |
| `file_name` | text | Original upload name. |
| `uploaded_at` | timestamptz | |

**`expenses`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, PK | |
| `employee_id` | uuid | Owning user. |
| `employee_name` | text | Denormalized for display. |
| `company_id` | text | |
| `expense_type` | text | Category — meals, lodging, transport, … |
| `amount` | numeric | |
| `currency` | text | Inferred from the receipt when not given. |
| `business_purpose` | text | |
| `status` | text | `Approved` \| `Flagged` \| `Rejected`. |
| `risk_level` | text | `Low` \| `Medium` \| `High`. |
| `reason` | text | Human-readable justification for the verdict. |
| `policy_snippet` | text | The policy passage the verdict rests on. |
| `claim_id` | uuid, null | Null while unattached ("available"). |
| `created_at` | timestamptz | |

Optional columns the API also writes when present: `vendor_name`,
`transaction_date`, `city`, `payment_type`, `invoice_number`, `gl_code`,
`image_url`, `duplicate_of`.

**`claims`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, PK | |
| `report_name` | text | |
| `entity` | text | Legal entity / business unit. |
| `employee_id` | uuid | |
| `employee_name` | text | |
| `company_id` | text | |
| `total_amount` | numeric | Recomputed on every attach/detach. |
| `status` | text | `Draft` → `Submitted` → `Approved`/`Flagged`/`Rejected`. |
| `created_at` | timestamptz | |

**`travel_plans`** — see [`backend/db/travel_plans.sql`](backend/db/travel_plans.sql)
for the exact DDL, including indexes on `employee_id` and `created_at`.

---

## API reference

Base URL: `http://127.0.0.1:8000` locally. Interactive docs at `/docs`.

Every endpoint except `/`, `/health` and the icon routes requires
`Authorization: Bearer <supabase-access-token>`.

### System

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Service banner and status. |
| `GET` | `/health` | `status`, `supabase_configured`, `ai_providers`, `model_warnings`, `boot_errors`, `time`. |

### Policy

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/upload-policy` | Multipart `file` (PDF) + `company_id`. Extracts text, upserts, warms the cache. 400 if the PDF has no extractable text. |
| `GET` | `/policy/{company_id}` | Stored policy metadata and preview. |
| `POST` | `/policy/ask` | `{ question, company_id }` → grounded answer. |

### Receipts and expenses

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/extract-receipt` | Multipart `file` + `business_purpose`, `employee_name`, `company_id`, `claim_id`. OCR → audit → persisted expense. 503 with an actionable message when vision is unavailable. |
| `POST` | `/expenses` | Manual entry: `expense_type`, `amount`, `transaction_date`, `vendor_name`, `currency`, `city`, `payment_type`, `business_purpose`, `gl_code`, `invoice_number`, `claim_id`. Audited identically. |
| `GET` | `/expenses` | Caller's expenses. `claim_id`, `limit`, `offset`. |
| `GET` | `/expenses/available` | Expenses not yet attached to a claim. |
| `POST` | `/expenses/{id}/attach` | Attach to a claim (form field `claim_id`). |
| `POST` | `/expenses/{id}/detach` | Detach and return to available. |
| `DELETE` | `/expenses/{id}` | Delete an expense. |
| `GET` | `/expenses/export.csv` | The caller's own expenses as a CSV download. |

### Claims

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/claims` | Create: `report_name`, `entity`, `employee_name`, `company_id`. Starts as `Draft`. |
| `GET` | `/claims/my` | Caller's claims, paginated. |
| `GET` | `/claims` | All claims (management views). |
| `POST` | `/claims/{id}/submit` | Draft → Submitted. |
| `POST` | `/claims/{id}/override` | Manager/finance status override. |
| `GET` | `/approvals` | Claims awaiting a decision. |

### Trips and analytics

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/trip-plans/generate` | `{ destination, start_date, end_date, business_purpose, company_id, activities, expensive_choices }` → plan + compliance score, persisted. |
| `GET` | `/trip-plans/my` | Caller's saved plans. |
| `GET` | `/analytics/summary` | `scope=my` (default, caller's own) or `scope=all` (company-wide). Compliance rate plus category/vendor/month breakdowns. |

Pagination: `limit` and `offset` are clamped by `sanitize_paging()` to a max of 500;
`limit=0` means "server default".

---

## The AI provider layer

`backend/ai_provider.py` exists because hardcoding model names at call sites caused a
production outage when a provider retired a model. Two rules follow from that:

1. **Callers name a task, never a model.** `call_ai_json(messages, task=TEXT, …)` or
   `task=VISION`. Model names live in this module and in configuration only.
2. **Model choices are verified, not assumed.** The pinned defaults were measured
   against the live account; `gemini-3.7-flash` and `gemini-flash-latest` hung 4/4
   times, and `gemini-2.5-flash` is retired. Re-run that verification before changing
   them.

**Dispatch:**

| Task | Chain | On total failure |
| --- | --- | --- |
| `TEXT` | Gemini → Groq (reversible via `AI_PRIMARY_PROVIDER`) | `AIUnavailableError` → HTTP 503 |
| `VISION` | Gemini only — the Groq account has no vision model | `AIUnavailableError` → HTTP 503 |

Both providers expose OpenAI-compatible chat endpoints, so one client class serves
both; only `base_url`, key and model differ.

**Resilience details:**

- `safe_json_loads()` recovers a JSON object even when the model wraps it in prose.
- Retries use backoff (`0.45s × attempt`); an empty or non-dict reply counts as a failure.
- `check_models()` runs at startup, reads each provider's catalog, and warns when a
  configured model has dropped out of it — surfacing drift at boot rather than as a
  500 mid-upload. It is bounded to a **5 s** timeout with `max_retries=0`, so it can
  never block a deploy, and its results land in `/health`'s `model_warnings`, kept
  separate from `boot_errors` so a transient network blip doesn't flip the service to
  "degraded".
- Gemini's catalog returns `models/gemini-3.5-flash` while the completions endpoint
  needs the bare name; `_normalize_model_id()` compares both sides normalized so a
  healthy boot doesn't emit a false warning.
- Gemini 3.x spends 670–840 tokens on hidden reasoning before its first visible
  token, and that counts against `max_tokens` — hence the ceilings of 1800 (OCR),
  1500 (audit) and 2500 (trip planning).

---

## Frontend guide

Single-page React app; `src/App.jsx` holds every page as a component, with page
switching by state rather than a router.

| Page | Component | Visible to |
| --- | --- | --- |
| Dashboard | `Dashboard` | all |
| Notifications | `NotificationsPage` | all |
| Trip Planner | `TripPlannerPage` | all |
| Expense Claims | `ClaimsPage`, `ClaimDetail`, `CreateClaimModal` | all |
| Submit Expense | `SubmitExpensePage`, `AddExpenseModal` | all |
| Available Expenses | `AvailableExpensesPage` | all |
| Spend Analytics | `AnalyticsPage` | all |
| Approvals | `ApprovalsPage` | manager, finance |
| Finance Dashboard | `FinanceDashboard` | manager, finance |
| Company Policy | `PolicyPage`, `PolicyAskCard` | all |

**Failure handling built into the shell** — a blank white page should be impossible:

- `main.jsx` renders a **setup screen** naming the exact missing `VITE_*` variables
  instead of letting `createClient()` throw at module scope.
- An **error boundary** shows any render-time crash with a reload button.
- `index.html` carries a **boot guard** that fires if the JS bundle 404s or throws at
  import time — the "wrong `outputDirectory`" class of failure.
- `supabase.js` reads the persisted session straight from `localStorage` for first
  paint, bypassing the SDK's navigator lock, which could deadlock across tabs.
- A non-blocking **backend status banner** covers Render's free-tier cold start and
  retries automatically instead of showing a dead error page.

---

## Testing

```bash
cd backend
source venv/bin/activate
pytest
```

37 tests, no network calls — providers are injected via `client_factory`, so the
suite runs offline and deterministically.

| File | Covers |
| --- | --- |
| `tests/test_ai_provider.py` | Chain construction, fallback order, vision having no fallback, `AIUnavailableError`, JSON recovery, env parsing, catalog checks. |
| `tests/test_startup.py` | The startup catalog hook never blocks or crashes boot. |
| `tests/test_extract_receipt_errors.py` | `/extract-receipt`'s exception-handler contract — a provider outage yields 503, not 500. |

---

## Deployment

Full walkthrough: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). In brief:

**Backend → Render.** Either *New → Blueprint* pointed at this repo (`render.yaml`
configures everything; you supply the secrets), or a manual Web Service with:

- Root Directory `backend`
- Build `pip install -r requirements.txt`
- Start `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Health Check Path `/health`

**Frontend → Vercel.** `vercel.json` sets the install command, build command, and
`outputDirectory: frontend/dist`. Add the three `VITE_*` variables and **redeploy**.

Dependencies are pinned to exact versions in both `requirements.txt` files, kept in
sync, so a breaking upstream release cannot kill a build with no change on your side.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank page / setup screen naming variables | `VITE_SUPABASE_URL` or `VITE_SUPABASE_KEY` unset in Vercel | Set them, then **redeploy** — not just restart. |
| "Audixa failed to start" + script 404 | Wrong `outputDirectory` | Must be `frontend/dist`. |
| "Connecting to server…" for ~1 min | Render free-tier cold start | Normal; it retries automatically. |
| "Cannot reach backend" after retries | `VITE_API_URL` wrong or service suspended | Open `<backend>/health` in a browser. |
| CORS error in console | Frontend origin not allowed | Set `FRONTEND_ORIGINS` on Render. |
| `/health` says `degraded` | A backend env var is missing | Read `boot_errors` in the response — it names the variable. |
| Image receipts 503 "Image scanning is temporarily unavailable" | `GEMINI_API_KEY` unset — vision has no fallback | Set `GEMINI_API_KEY`. |
| `model_warnings` in `/health` | A configured model left the provider's catalog | Update `GEMINI_TEXT_MODEL` / `GROQ_TEXT_MODEL` after verifying the replacement. |
| Policy upload 400 "No readable text" | Scanned-image PDF | Upload a text-based PDF. |
| Receipt images 404 after a redeploy | `backend/uploads/` is ephemeral on Render | Expected — see below. |

---

## Known limitations

- **Receipt files are ephemeral in production.** `backend/uploads/` sits on Render's
  ephemeral disk, so images are lost on every restart, redeploy and cold-start
  recovery. Audit results in Supabase survive; only the files disappear. The proper
  fix is Supabase Storage or a Render persistent disk (paid).
- **Vision has no fallback.** No `GEMINI_API_KEY`, no image receipts. PDF and manual
  entry still work via the text chain.
- **Free-tier cold starts.** The first request after ~15 min idle takes 30–60 s.
- **Policy retrieval is keyword-based**, not semantic — an unusually worded policy
  section can be missed by the context trimmer.
- **Two large files.** `backend/main.py` (~1.7k lines) and `frontend/src/App.jsx`
  (~3.5k lines) are each a single module; splitting them into routers and page
  modules is the obvious next refactor.

---

## Roadmap

- True semantic retrieval over policy chunks (vector index)
- Supabase Storage for receipt files
- Background job queue for OCR and auditing
- Real-time status via WebSocket / SSE
- Policy versioning with diff-aware audit reasoning
- Automated receipt-to-trip-plan matching with confidence scores

---

## Further reading

- [`docs/APPROACH.md`](docs/APPROACH.md) — problem framing, design rationale, impact.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — full Render + Vercel walkthrough.
- [`docs/superpowers/`](docs/superpowers/) — implementation plans and specs.
- `backend/ai_provider.py` — the module's docstrings record *why* each model and
  timeout is what it is. Read them before changing any of those values.
