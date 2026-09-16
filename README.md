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

Stored on the `profiles` row and **enforced server-side**. Every privileged endpoint
depends on `require_finance`, which reads the caller's role from `profiles` on each
request — never from the token, a form field, or a query parameter. `isFinance` in
`App.jsx` still hides navigation, but it is now cosmetic: bypassing it gets a 403.

- `employee` — submits their own expenses, claims, mileage and trips; reads the
  company policy; sees only their own spend.
- `manager` — the above, plus approving other people's claims.
- `finance` — approves, and owns the policy, the exchange rates and company-wide
  reporting.
- `admin` — manages people, roles and deployment configuration.

**Admin is deliberately not a superset of finance.** Whoever can grant approval
rights should not also be able to use them, or one account can quietly give
itself the power to approve its own spend. `require_finance`, `require_policy_editor`
and `require_admin` are three separate gates, and
`tests/test_roles_and_features.py` pins the split down in both directions.

**Roles cannot be self-assigned.** Signup always creates an `employee`;
`backend/db/profiles_authorization.sql` enforces that with RLS plus a trigger that
pins `role` and `company_id` against client writes. Promotion goes through
`POST /admin/users/{user_id}/role`, which requires an existing **admin** — so the
first one is promoted by hand in the SQL editor. That file's closing comment has
the statements.

`GET /me` returns the caller's capability set, and the navigation renders from
that rather than from a role string in the browser. It is a rendering hint only:
every endpoint still checks for itself, so a tampered response changes what is
drawn, never what is allowed.

Scope is always derived, never requested: an employee calling
`/analytics/summary?scope=all` receives their own data rather than an error, and for
an approver `all` means their own company, not every company in the database.

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
2. `get_principal()` validates the token against Supabase, then reads the caller's
   `profiles` row for their role and `company_id`. Both come from the server, never
   from the request — the form's `company_id` field is accepted and ignored.
3. `store_receipt()` writes the file to the private Supabase Storage bucket and
   stores the object path on the expense row. Reading it later goes through
   `GET /receipts/{expense_id}`, which checks access and mints a 5-minute signed URL.
4. PDFs are text-extracted locally; images are base64'd for the vision model.
5. `build_policy_context()` retrieves the policy passages relevant to this receipt —
   hybrid vector + full-text search over `policy_chunks`, fused by RRF — and returns
   the chunks alongside the text, so the citation can be checked afterwards. In
   `shadow` mode it also runs the old keyword trimmer and logs the difference.
6. `call_ai_json()` runs OCR, then a second call runs the policy audit against the
   numbered chunks. `apply_citation()` verifies the id the model returned was one it
   was actually shown, replaces `policy_snippet` with the cited text, and downgrades
   an approval to Flagged if the citation does not check out.
7. `resolve_expense_status()` normalizes the verdict, `apply_fx()` converts the amount
   into the base currency, `apply_duplicate_check()` looks for a prior identical
   expense, and the row is inserted.
8. If the expense belongs to a claim, `sync_claim_status_totals()` recomputes the
   claim's total and status.

**Design decisions worth knowing:**

- **Nothing blocking runs on the event loop.** Handlers that need no `await` are
  plain `def`, so FastAPI runs them in its threadpool and their synchronous Supabase
  calls cannot stall the process. The five that must stay `async def` — they await an
  upload or an AI call — put every blocking call underneath through `offload()`. AI
  completions are natively async (`AsyncOpenAI`) with one pooled client per provider.
  Before this, a single 10–12s vision call froze every other request in the
  deployment, `/health` included.
- **Boot never crashes on bad config.** Missing env vars are collected into
  `BOOT_ERRORS` and reported by `/health` as `"degraded"`, instead of killing the
  process and leaving the frontend with an unexplained "cannot reach backend".
- **The schema is in version control.** `backend/db/001_init.sql` defines every
  column the API writes, so a mismatch is a deployment fault that says so rather
  than a row that silently loses a field. This replaced
  `insert_*_with_schema_fallback()`, which retried an insert up to twelve times,
  stripping whichever column Postgres named — so a table missing an optional column
  produced an expense with no policy_snippet and an HTTP 200.
- **Policy retrieval is hybrid, and verdicts cite it.** The policy is chunked on its
  own headings at upload, embedded once, and searched with vector + full-text
  rankings fused by RRF (`match_policy_chunks`). The audit prompt numbers the
  retrieved chunks and the model must name the one it relied on; `apply_citation()`
  checks that id was actually retrieved and **downgrades an approval to Flagged when
  it was not**. So `policy_snippet` is text copied out of the policy, not text the
  model wrote — and a receipt carrying injected instructions cannot manufacture a
  chunk id that was in front of the model.
  `POLICY_RETRIEVAL_MODE` defaults to `shadow`: both paths run, the old one decides,
  and disagreements are logged. Switch to `vector` once those logs look right.
- **Money is stored twice.** Each expense keeps its original `amount`/`currency` and
  a `amount_base` converted at the rate in force on its transaction date. Only
  `amount_base` is ever summed; rows with no rate on file are excluded and reported,
  never added at an implied 1:1.
- **Aggregation happens in Postgres.** `analytics_summary` (db/004_analytics.sql)
  returns one row instead of streaming the table into a Python loop that silently
  stopped at PostgREST's 1000-row cap.
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
│   ├── main.py                  app assembly only — CORS, mount, routers (~75 lines)
│   ├── config.py                env, tuning constants, BOOT_ERRORS, TTLCache
│   ├── db.py                    Supabase client, offload(), insert_row, paging
│   ├── deps.py                  Principal, require_finance, claim/ownership loaders
│   ├── domain/                  pure rules, no I/O — trivially testable
│   │   ├── status.py            canonical/resolve/derive status, compose_reason
│   │   ├── money.py             amount parsing, currency inference, FX conversion
│   │   ├── duplicates.py        prior-identical-expense detection
│   │   └── util.py              paging and coercion helpers
│   ├── services/
│   │   ├── policy.py            versioning, chunk ingest, hybrid retrieval
│   │   ├── audit.py             prompts + citation verification
│   │   ├── receipts.py          PDF text, object storage, signed URLs
│   │   └── claims.py            claim totals and status sync
│   ├── routers/                 policy · trips · expenses · claims · admin ·
│   │                            analytics · health
│   ├── ai_provider.py           JSON completions, embeddings, fallback chain
│   ├── policy_rag.py            chunking, retrieval queries, citation checking
│   ├── requirements.txt         pinned, exact versions
│   ├── pytest.ini               testpaths = tests
│   ├── Procfile                 uvicorn start command
│   ├── .env.example             template — copy to backend/.env
│   ├── db/
│   │   ├── 001_init.sql … 005_policy_chunks.sql   schema, FX, analytics, RAG
│   │   ├── travel_plans.sql     schema for the trip-planning table
│   │   └── profiles_authorization.sql  RLS + trigger pinning role/company_id
│   ├── tests/                   99 tests
│   └── uploads/                 legacy receipt storage (gitignored, ephemeral)
│
├── frontend/                    React + Vite SPA
│   ├── index.html               boot guard that reports a failed JS bundle
│   ├── package.json
│   ├── vite.config.js
│   ├── .env.example             template — copy to frontend/.env
│   ├── public/audixa-logo.png
│   └── src/
│       ├── main.jsx             root render, setup notice, error boundary
│       ├── App.jsx              shell + routing only (~310 lines)
│       ├── supabase.js          client, session persistence, config guards
│       ├── index.css
│       ├── lib/                 api.js (base URL + getToken) · format.js ·
│       │                        useIsMobile.js
│       ├── theme/tokens.js      THEME palette and primaryBtnStyle
│       ├── components/ui.jsx    StatusBadge · Input · Select
│       └── pages/               16 modules, route-level ones lazy-loaded
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

In the Supabase SQL editor, run these **in order**. Each is idempotent, so an
existing project converges rather than breaking.

| # | File | What it does |
| --- | --- | --- |
| 1 | [`001_init.sql`](backend/db/001_init.sql) | Every table and column the API writes, plus the indexes `expenses` and `claims` never had. Required before the app can stop guessing at its own schema. |
| 2 | [`002_normalize_expense_status.sql`](backend/db/002_normalize_expense_status.sql) | Normalizes `expenses.status` so reads can trust it. Aggregation cannot move into Postgres while the stored verdict differs from the one the app believes. |
| 3 | [`003_fx.sql`](backend/db/003_fx.sql) | `fx_rates` plus the base-currency columns. **Seed a rate for every currency you use** — its closing comment has the statement. |
| 4 | [`004_analytics.sql`](backend/db/004_analytics.sql) | The `analytics_summary` aggregation function. Without it `/analytics/summary` returns 503. |
| 5 | [`005_policy_chunks.sql`](backend/db/005_policy_chunks.sql) | pgvector, `policy_chunks`, the hybrid `match_policy_chunks` function, and the citation columns on `expenses`. **Re-upload your policy afterwards** — chunks are written at upload time, so existing policies have none. |
| 6 | [`006_employee_fields.sql`](backend/db/006_employee_fields.sql) | Missing-receipt declarations, mileage, cost centres, reimbursement tracking, and the `mileage_rates` table. **Seed a mileage rate** — its closing comment has the statement. |
| 7 | [`007_profiles_and_recovery.sql`](backend/db/007_profiles_and_recovery.sql) | Profile fields (phone, job title, company name, photo) and security-question password recovery. Also create a **private `avatars` storage bucket**. |
| 8 | [`travel_plans.sql`](backend/db/travel_plans.sql) | The trip-planning table. |
| 9 | [`profiles_authorization.sql`](backend/db/profiles_authorization.sql) | RLS and the trigger that stop users granting themselves a role. |

Step 9 is **required, not optional**. Without it the browser can still write its own
`profiles.role`, and every server-side role check downstream is trivially bypassed by
signing up as finance. Its closing comment has the one-off statement that promotes
your first **administrator** and your first finance user — nobody can self-assign a role afterwards.

Then, under **Storage → New bucket**, create a bucket named `receipts` with **Public
bucket OFF**. Receipts are served through short-lived signed URLs gated on
ownership, so a public bucket would undo that. Set `SUPABASE_RECEIPT_BUCKET` if you
name it something else.

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
| `POST` | `/upload-policy` | **Approvers only.** Multipart `file` (PDF). Extracts text, upserts, warms the cache. `company_id` comes from the caller's profile; any form value is ignored. 400 if the PDF has no extractable text. |
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
| `GET` | `/receipts/{expense_id}` | `{"url", "expires_in"}` — a 5-minute signed URL for that receipt. The owner, or an approver in the same company. 404 if the receipt predates object storage and its file is gone. |

### Claims

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/claims` | Create: `report_name`, `entity`, `employee_name`, `company_id`. Starts as `Draft`. |
| `GET` | `/claims/my` | Caller's claims, paginated. |
| `GET` | `/claims` | All claims (management views). |
| `POST` | `/claims/{id}/submit` | Draft → Submitted. |
| `POST` | `/claims/{id}/override` | **Approvers only**, own company only, and never on your own claim (403). |
| `GET` | `/approvals` | **Approvers only.** Claims awaiting a decision, scoped to the caller's company. |
| `POST` | `/admin/users/{user_id}/role` | **Approvers only.** Body `{"role": "employee"\|"manager"\|"finance"}`. Same company only; you cannot change your own. The only way to grant a role once `profiles_authorization.sql` is applied. |

### Trips and analytics

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/trip-plans/generate` | `{ destination, start_date, end_date, business_purpose, company_id, activities, expensive_choices }` → plan + compliance score, persisted. |
| `GET` | `/trip-plans/my` | Caller's saved plans. |
| `GET` | `/analytics/summary` | `scope=my` (default) or `scope=all`. `all` is honoured only for approvers and means their own company; everyone else silently gets their own data. The response echoes the scope actually applied. |

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
| `tests/test_authorization.py` | The role gate, claim ownership, self-approval, and analytics scope derivation. Each test names the call that used to succeed. |

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

- **Receipts uploaded before Supabase Storage are gone.** New receipts go to a
  private bucket and are served through signed URLs. Anything uploaded earlier was
  written to Render's ephemeral disk and did not survive the next deploy; those rows
  now return a 404 explaining why. If no bucket is reachable, uploads still fall back
  to that ephemeral disk and log a warning — check for it before trusting the setup.
- **Legacy `/uploads` files are unauthenticated.** The static mount stays so
  pre-storage receipts still open where they exist. Anything reached through
  `GET /receipts/{expense_id}` is ownership-checked; the mount is not, and can be
  removed once no rows reference it.
- **Vision has no fallback.** No `GEMINI_API_KEY`, no image receipts. PDF and manual
  entry still work via the text chain.
- **Free-tier cold starts.** The first request after ~15 min idle takes 30–60 s.
- **Rates are seeded by hand.** `fx_rates` has no automatic feed; an expense in a
  currency with no rate on file is excluded from totals and reported as
  unconverted. Wiring a rate provider is a follow-up.
- **Retrieval defaults to shadow mode.** Until `POLICY_RETRIEVAL_MODE=vector` is set,
  audits still decide with the old keyword trimmer; retrieval only runs alongside and
  logs. Citations are therefore not enforced on verdicts until you switch.
- **Policies that predate `005_policy_chunks.sql` have no chunks.** Chunking happens
  at upload, so retrieval returns nothing and audits fall back to keyword context
  until the policy is re-uploaded.

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
