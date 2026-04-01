# ExpenseAuditor

## The Problem

Manual expense reporting is tedious, error-prone, and slow. Finance teams spend countless hours manually reviewing receipts against complex company policies, which leads to delayed reimbursements, human error, and potential compliance risks.

## The Solution

ExpenseAuditor is an AI-powered compliance platform that automates the entire expense claim workflow. Employees upload their receipts, and the system uses AI-powered OCR to instantly extract transaction data. An AI auditor then evaluates the extracted data against the company's specific travel and expense policies in real-time, automatically approving, rejecting, or flagging the claim. This drastically reduces manual review time and ensures 100% policy compliance.

## Tech Stack

- **Programming Languages:** Python, JavaScript
- **Frontend:** React, Vite
- **Backend:** FastAPI, Uvicorn
- **Database, Auth & Storage:** Supabase (PostgreSQL)
- **AI & LLMs:** Groq API (Llama Vision for OCR, Llama-based models for Policy Auditing)
- **APIs / Data Processing:** Axios, PyPDF2

## Setup Instructions

Follow these steps to run the project locally.

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd expense-auditor
```

### 2. Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install fastapi uvicorn python-multipart python-dotenv groq supabase PyPDF2 pillow
   ```
4. Create a `.env` file in the `backend/` directory with your API keys:
   ```env
   GROQ_API_KEY=your_groq_api_key
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   ```
5. Start the backend server:
   ```bash
   python -m uvicorn main:app --reload --app-dir .
   ```
   _The backend will be running at http://127.0.0.1:8000._

### 3. Frontend Setup

1. Open a new terminal and navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies (ensure you are using Node 18 or above):
   ```bash
   npm install
   ```
3. Create a `.env` file in the `frontend/` directory with your Supabase keys:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_KEY=your_supabase_anon_key
   ```
4. Start the frontend development server:
   ```bash
   npm run dev
   ```
   _The frontend will be accessible at http://localhost:5173._
