from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from groq import Groq
from supabase import create_client, Client
import base64
import json
import os
import uuid
from datetime import datetime
from pathlib import Path
import PyPDF2
import io

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

groq_client = Groq(api_key=GROQ_API_KEY)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
admin_supabase: Client | None = None
if SUPABASE_SERVICE_ROLE_KEY:
    admin_supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

OCR_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
AUDIT_MODEL = "llama-3.3-70b-versatile"

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()

DEFAULT_POLICY = """
COMPANY TRAVEL & EXPENSE POLICY:
1. Meals: Max $50 per meal per person. Alcohol is NOT reimbursable.
2. Transport: Flights must be economy class. Max $150/day for car rental.
3. Lodging: Max $200/night for hotels.
4. Team Building events are only allowed on weekdays.
5. All expenses must have a clear business purpose.
6. Receipts older than 30 days will not be reimbursed.
7. Entertainment expenses over $100 require manager pre-approval.
"""


@app.post("/auth/register")
async def register_user(payload: dict):
    if not admin_supabase:
        raise HTTPException(
            status_code=500, detail="Service role key not configured")

    email = payload.get("email")
    password = payload.get("password")
    full_name = payload.get("full_name")
    role = payload.get("role", "employee")
    company_id = payload.get("company_id", "default")

    if not email or not password:
        raise HTTPException(
            status_code=400, detail="Email and password are required")

    try:
        user_resp = admin_supabase.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True,
        })
        user = user_resp.user
        if not user:
            raise HTTPException(
                status_code=500, detail="Failed to create user")

        supabase.table("profiles").upsert({
            "id": user.id,
            "full_name": full_name,
            "role": role,
            "company_id": company_id,
        }).execute()

        return {"success": True, "user_id": user.id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


def get_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        user = supabase.auth.get_user(token)
        return user.user
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    try:
        reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception:
        return ""


def get_policy_text(company_id: str) -> str:
    try:
        res = supabase.table("policies").select(
            "policy_text").eq("company_id", company_id).execute()
        if res.data and res.data[0].get("policy_text"):
            return res.data[0]["policy_text"]
    except Exception:
        pass
    return DEFAULT_POLICY


@app.post("/upload-policy")
async def upload_policy(
    file: UploadFile = File(...),
    company_id: str = Form(...),
    user=Depends(get_user)
):
    pdf_bytes = await file.read()
    policy_text = extract_text_from_pdf(pdf_bytes)
    if not policy_text.strip():
        raise HTTPException(
            status_code=400, detail="Could not extract text from PDF")

    supabase.table("policies").upsert({
        "company_id": company_id,
        "policy_text": policy_text,
        "file_name": file.filename,
        "uploaded_by": str(user.id),
        "uploaded_at": datetime.now().isoformat()
    }, on_conflict="company_id").execute()

    return {"success": True, "characters": len(policy_text), "preview": policy_text[:300]}


@app.get("/policy/{company_id}")
async def get_policy(company_id: str, user=Depends(get_user)):
    try:
        res = supabase.table("policies").select(
            "*").eq("company_id", company_id).execute()
        if res.data:
            return {"exists": True, "policy": res.data[0]}
        return {"exists": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/extract-receipt")
async def extract_receipt(
    file: UploadFile = File(...),
    business_purpose: str = Form(...),
    employee_name: str = Form(default="Anonymous"),
    claimed_date: str = Form(default=""),
    company_id: str = Form(default="default"),
    user=Depends(get_user)
):
    image_data = await file.read()
    mime_type = file.content_type or "image/jpeg"
    image_b64 = base64.b64encode(image_data).decode("ascii")

    # Upload image to Supabase Storage
    img_filename = f"{uuid.uuid4()}.jpg"
    try:
        supabase.storage.from_("receipts").upload(
            img_filename, image_data,
            file_options={"content-type": mime_type}
        )
        img_url = supabase.storage.from_(
            "receipts").get_public_url(img_filename)
    except Exception:
        img_url = ""

    # OCR
    ocr_prompt = """Extract from this receipt and return ONLY valid JSON, no markdown:
{
  "merchant_name": "...",
  "date": "...",
  "total_amount": "...",
  "currency": "USD",
  "category": "Meals / Transport / Lodging / Other",
  "readable": true
}
If unreadable set readable to false and empty strings for other fields."""

    try:
        ocr_resp = groq_client.chat.completions.create(
            model=OCR_MODEL,
            messages=[{"role": "user", "content": [
                {"type": "text", "text": ocr_prompt},
                {"type": "image_url", "image_url": {
                    "url": f"data:{mime_type};base64,{image_b64}"}}
            ]}],
            temperature=0,
            response_format={"type": "json_object"},
        )
        extracted = json.loads(ocr_resp.choices[0].message.content)
    except Exception as e:
        extracted = {"merchant_name": "", "date": "", "total_amount": "",
                     "currency": "", "category": "", "readable": False}

    # Get company policy
    policy_text = get_policy_text(company_id)

    # Audit
    audit_prompt = f"""You are a strict financial compliance auditor.

Company Policy:
{policy_text}

Receipt:
- Merchant: {extracted.get('merchant_name')}
- Date: {extracted.get('date')}
- Amount: {extracted.get('currency')} {extracted.get('total_amount')}
- Category: {extracted.get('category')}
- Business Purpose: {business_purpose}

Return ONLY valid JSON:
{{
  "status": "Approved" or "Flagged" or "Rejected",
  "reason": "One sentence citing the specific policy rule",
  "policy_snippet": "The exact policy rule that applies",
  "risk_level": "Low" or "Medium" or "High"
}}"""

    try:
        audit_resp = groq_client.chat.completions.create(
            model=AUDIT_MODEL,
            messages=[{"role": "user", "content": audit_prompt}],
            temperature=0,
            response_format={"type": "json_object"},
        )
        audit = json.loads(audit_resp.choices[0].message.content)
    except Exception:
        audit = {"status": "Flagged", "reason": "Could not complete audit",
                 "policy_snippet": "", "risk_level": "Medium"}

    # Save claim to Supabase
    claim = {
        "employee_id": str(user.id),
        "employee_name": employee_name,
        "company_id": company_id,
        "merchant_name": extracted.get("merchant_name"),
        "date": extracted.get("date"),
        "claimed_date": claimed_date,
        "total_amount": extracted.get("total_amount"),
        "currency": extracted.get("currency"),
        "category": extracted.get("category"),
        "business_purpose": business_purpose,
        "readable": extracted.get("readable", True),
        "status": audit.get("status"),
        "reason": audit.get("reason"),
        "policy_snippet": audit.get("policy_snippet"),
        "risk_level": audit.get("risk_level"),
        "image_url": img_url,
        "submitted_at": datetime.now().isoformat(),
    }

    try:
        res = supabase.table("claims").insert(claim).execute()
        saved = res.data[0] if res.data else claim
    except Exception as e:
        print("Insert failed:", str(e))
        saved = claim

    return {"success": True, "data": saved}


@app.get("/claims")
async def get_claims(user=Depends(get_user)):
    res = supabase.table("claims").select(
        "*").order("submitted_at", desc=True).execute()
    risk_order = {"High": 0, "Medium": 1, "Low": 2}
    sorted_claims = sorted(
        res.data, key=lambda x: risk_order.get(x.get("risk_level"), 3))
    return {"claims": sorted_claims}


@app.get("/claims/my")
async def get_my_claims(user=Depends(get_user)):
    res = supabase.table("claims").select(
        "*").eq("employee_id", str(user.id)).order("submitted_at", desc=True).execute()
    return {"claims": res.data}


@app.get("/claims/{claim_id}")
async def get_claim(claim_id: str, user=Depends(get_user)):
    res = supabase.table("claims").select("*").eq("id", claim_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Claim not found")
    return {"claim": res.data[0]}


@app.post("/claims/{claim_id}/override")
async def override_claim(claim_id: str, body: dict, user=Depends(get_user)):
    supabase.table("claims").update({
        "status": body.get("status"),
        "override_comment": body.get("comment"),
        "override_by": str(user.id)
    }).eq("id", claim_id).execute()
    res = supabase.table("claims").select("*").eq("id", claim_id).execute()
    return {"success": True, "claim": res.data[0]}
