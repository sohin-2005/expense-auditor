# Project Title

## Audixa – Policy-First Expense Auditor

## The Problem

Most expense workflows are reactive: employees spend first, then finance finds policy violations during reimbursement review. This creates delays, rework, rejected claims, and poor visibility for both employees and finance teams. Companies need a faster, policy-aware system that prevents non-compliant spend earlier.

## The Solution

Audixa is an AI-powered expense and compliance platform built around company policy enforcement. It supports receipt OCR, AI-based policy auditing, claim lifecycle tracking, notifications, and a pre-trip planning assistant that estimates compliant travel choices before spend happens. By combining policy parsing, structured audits, and real-time status views, Audixa reduces manual review effort and improves approval confidence.

Key features:

- AI receipt extraction and structured expense capture
- Policy-aware audit decisions (`Approved`, `Flagged`, `Rejected`)
- Expense claims workflow with manager/finance override support
- Notifications for claim/receipt status changes
- Compliance-Aware Itinerary Architect (pre-trip planning with compliance score)

## Tech Stack

- **Programming Languages:** Python, JavaScript
- **Frontend:** React, Vite, Lucide React
- **Backend:** FastAPI, Uvicorn
- **Database/Auth:** Supabase (PostgreSQL + Auth)
- **AI / APIs:** Groq API (OCR + policy auditing/planning LLM calls)
- **Libraries / Tools:** Axios, PyPDF2, python-dotenv, python-multipart

## Setup Instructions

### 1) Clone and enter project

```bash
git clone <your-repo-url>
cd expense-auditor
```

### 2) Backend setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn python-multipart python-dotenv groq supabase PyPDF2 pillow
```

Create `backend/.env`:

```env
GROQ_API_KEY=your_groq_api_key
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
EXPENSE_AUDIT_FAST_MODE=1
GROQ_TIMEOUT_SECONDS=25
```

Run backend:

```bash
python -m uvicorn main:app --reload --app-dir .
```

Backend URL: `http://127.0.0.1:8000`

### 3) Database setup (Supabase)

Run the SQL in [backend/travel_plans.sql](backend/travel_plans.sql) in the Supabase SQL editor to create the pre-trip planning table.

### 4) Frontend setup

Open a new terminal:

```bash
cd frontend
npm install
```

Create `frontend/.env`:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_KEY=your_supabase_anon_key
```

Run frontend:

```bash
npm run dev
```

Frontend URL: `http://localhost:5173`
