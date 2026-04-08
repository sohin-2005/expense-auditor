from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Depends, Header, Body, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from supabase import create_client, Client
from groq import Groq
from dotenv import load_dotenv
from pathlib import Path
from datetime import datetime
import uuid
import os
import base64
import json
import io
import re
import time
import PyPDF2

# ───────────────── CONFIG ─────────────────


app = FastAPI()


@app.get("/")
def home():
    return {"message": "backend working"}


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
groq_client = Groq(api_key=GROQ_API_KEY)

OCR_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
AUDIT_MODEL = "llama-3.1-8b-instant"

FAST_MODE = os.getenv("EXPENSE_AUDIT_FAST_MODE", "1").strip().lower() in {
    "1", "true", "yes", "on"}

OCR_MAX_TOKENS = 220 if FAST_MODE else 280
AUDIT_MAX_TOKENS = 170 if FAST_MODE else 220
TRIP_MAX_TOKENS = 650 if FAST_MODE else 900

OCR_RETRIES = 0 if FAST_MODE else 1
AUDIT_RETRIES = 1 if FAST_MODE else 2

POLICY_CONTEXT_MAX_CHARS = 12000 if FAST_MODE else 18000
RECEIPT_PDF_MAX_PAGES = 8 if FAST_MODE else 20
RECEIPT_PDF_TEXT_MAX_CHARS = 7000 if FAST_MODE else 12000
GROQ_TIMEOUT_SECONDS = float(os.getenv("GROQ_TIMEOUT_SECONDS", "25"))

POLICY_CACHE_TTL_SECONDS = 300
_policy_cache = {}

app = FastAPI(title="ExpenseFlow API")

frontend_origins_env = os.getenv("FRONTEND_ORIGINS", "")
extra_frontend_origins = [
    o.strip() for o in frontend_origins_env.split(",") if o.strip()
]
default_frontend_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
allowed_frontend_origins = list(dict.fromkeys(
    default_frontend_origins + extra_frontend_origins
))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_frontend_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)


@app.get("/apple-touch-icon.png", include_in_schema=False)
def apple_touch_icon():
    return Response(status_code=204)


@app.get("/apple-touch-icon-precomposed.png", include_in_schema=False)
def apple_touch_icon_precomposed():
    return Response(status_code=204)

# ───────────────── AUTH ─────────────────


async def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    token = authorization.split(" ")[1]
    try:
        user = supabase.auth.get_user(token)
        return user.user
    except:
        raise HTTPException(401, "Invalid token")

# ───────────────── UTIL ─────────────────


def extract_text_from_pdf(pdf_bytes: bytes, max_pages: int = 40, max_chars: int = 120000):
    try:
        reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))
        chunks = []
        for page in reader.pages[:max_pages]:
            try:
                chunks.append(page.extract_text() or "")
            except:
                chunks.append("")
        return "\n".join(chunks)[:max_chars]
    except:
        return ""


def get_policy_record(company_id: str):
    try:
        res = (
            supabase.table("policies")
            .select("*")
            .eq("company_id", company_id)
            .order("uploaded_at", desc=True)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0]
    except:
        pass
    return None


def get_policy(company_id: str):
    key = str(company_id or "default")
    cached = _policy_cache.get(key)
    now = time.time()
    if cached and cached.get("expires_at", 0) > now and cached.get("policy_text"):
        return cached.get("policy_text")

    record = get_policy_record(key)
    if record and record.get("policy_text"):
        text = record["policy_text"]
        _policy_cache[key] = {
            "policy_text": text,
            "expires_at": now + POLICY_CACHE_TTL_SECONDS,
            "uploaded_at": record.get("uploaded_at"),
        }
        return text
    return "Standard business expense rules apply."


def get_policy_context(policy_text: str, context_payload: dict, max_chars: int = POLICY_CONTEXT_MAX_CHARS):
    text = str(policy_text or "").strip()
    if not text:
        return "Standard business expense rules apply."
    if len(text) <= max_chars:
        return text

    query_bits = []
    for k in [
        "type", "expense_type", "category", "city", "vendor_name", "vendor",
        "business_purpose", "payment_type", "destination", "activities"
    ]:
        v = context_payload.get(k)
        if isinstance(v, list):
            query_bits.extend([str(x) for x in v])
        elif v is not None:
            query_bits.append(str(v))

    query = " ".join(query_bits).lower()
    words = [w for w in re.findall(r"[a-zA-Z]{3,}", query) if w]
    if not words:
        return text[:max_chars]

    chunks = [c.strip() for c in re.split(r"\n\s*\n+", text) if c.strip()]
    scored = []
    for chunk in chunks:
        cl = chunk.lower()
        score = 0
        for w in words:
            if w in cl:
                score += 1
        if score > 0:
            scored.append((score, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)
    selected = []
    size = 0
    for _, chunk in scored:
        if size + len(chunk) + 2 > max_chars:
            continue
        selected.append(chunk)
        size += len(chunk) + 2
        if size >= int(max_chars * 0.92):
            break

    if not selected:
        return text[:max_chars]
    return "\n\n".join(selected)


def safe_json_loads(raw_text: str):
    if not raw_text:
        return {}
    try:
        return json.loads(raw_text)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", raw_text)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return {}
    return {}


def call_groq_json(messages, model: str, max_tokens: int, temperature: float = 0, retries: int = 2):
    last_err = None
    for attempt in range(retries + 1):
        try:
            client = groq_client
            if hasattr(groq_client, "with_options"):
                client = groq_client.with_options(timeout=GROQ_TIMEOUT_SECONDS)

            resp = client.chat.completions.create(
                model=model,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=temperature,
                max_tokens=max_tokens,
            )
            parsed = safe_json_loads(resp.choices[0].message.content)
            if isinstance(parsed, dict) and parsed:
                return parsed
            raise ValueError("Model returned empty/invalid JSON")
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(0.45 * (attempt + 1))
                continue
            break
    raise last_err


def parse_amount_value(raw):
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)

    text = str(raw).strip()
    if not text:
        return None

    # Keep the first numeric-looking token, remove currency symbols/text
    m = re.search(r"[-+]?\d[\d\s,\.]*", text)
    if not m:
        return None

    num = m.group(0).replace(" ", "")

    # Handle different thousand/decimal separators
    if "," in num and "." in num:
        # whichever appears last is likely decimal separator
        if num.rfind(",") > num.rfind("."):
            num = num.replace(".", "").replace(",", ".")
        else:
            num = num.replace(",", "")
    elif "," in num and "." not in num:
        # If last group is 1-2 digits, treat comma as decimal separator
        last = num.split(",")[-1]
        if len(last) in (1, 2):
            num = num.replace(".", "").replace(",", ".")
        else:
            num = num.replace(",", "")
    else:
        num = num.replace(",", "")

    try:
        return float(num)
    except:
        return None


def infer_currency_code(raw_currency, raw_amount):
    if raw_currency and str(raw_currency).strip():
        return str(raw_currency).strip().upper()

    text = str(raw_amount or "")
    symbol_map = {
        "₹": "INR",
        "$": "USD",
        "€": "EUR",
        "£": "GBP",
        "¥": "JPY",
        "₩": "KRW",
        "₽": "RUB",
        "₺": "TRY",
        "₫": "VND",
        "₪": "ILS",
        "₦": "NGN",
        "AED": "AED",
        "SAR": "SAR",
        "QAR": "QAR",
    }
    for symbol, code in symbol_map.items():
        if symbol in text.upper():
            return code

    return "USD"


def insert_expense_with_schema_fallback(expense: dict):
    payload = dict(expense)
    for _ in range(12):
        try:
            return supabase.table("expenses").insert(payload).execute()
        except Exception as e:
            msg = str(e)
            missing_col = None
            m = re.search(r"Could not find the '([^']+)' column", msg)
            if m:
                missing_col = m.group(1)

            if missing_col and missing_col in payload:
                payload.pop(missing_col, None)
                continue
            raise

    raise HTTPException(
        status_code=500,
        detail="Expense insert failed due to schema mismatch"
    )


def insert_claim_with_schema_fallback(claim: dict):
    payload = dict(claim)
    for _ in range(12):
        try:
            return supabase.table("claims").insert(payload).execute()
        except Exception as e:
            msg = str(e)
            missing_col = None
            m = re.search(r"Could not find the '([^']+)' column", msg)
            if m:
                missing_col = m.group(1)

            if missing_col and missing_col in payload:
                payload.pop(missing_col, None)
                continue
            raise

    raise HTTPException(
        status_code=500,
        detail="Claim insert failed due to schema mismatch"
    )


def insert_travel_plan_with_schema_fallback(plan: dict):
    payload = dict(plan)
    for _ in range(16):
        try:
            return supabase.table("travel_plans").insert(payload).execute()
        except Exception as e:
            msg = str(e)
            missing_col = None
            m = re.search(r"Could not find the '([^']+)' column", msg)
            if m:
                missing_col = m.group(1)

            if missing_col and missing_col in payload:
                payload.pop(missing_col, None)
                continue
            raise

    raise HTTPException(
        status_code=500,
        detail="Travel plan insert failed due to schema mismatch"
    )


def derive_claim_status(expenses: list):
    if not expenses:
        return "Draft"

    statuses = []
    for e in expenses:
        corrected = resolve_expense_status(
            e.get("status"),
            reason=e.get("reason"),
            amount=e.get("amount"),
        )
        s = str(corrected or "").strip().lower()
        if s:
            statuses.append(s)

    if not statuses:
        return "Flagged"
    if any(s == "rejected" for s in statuses):
        return "Rejected"
    if any(s == "flagged" for s in statuses):
        return "Flagged"
    if all(s == "approved" for s in statuses):
        return "Approved"
    return "Flagged"


def canonical_status(status_value, default: str = "Flagged"):
    raw = str(status_value or "").strip().lower()
    if not raw:
        return default
    mapping = {
        "approved": "Approved",
        "approve": "Approved",
        "ok": "Approved",
        "flagged": "Flagged",
        "flag": "Flagged",
        "needs review": "Flagged",
        "pending approval": "Flagged",
        "rejected": "Rejected",
        "reject": "Rejected",
        "denied": "Rejected",
        "draft": "Draft",
    }
    return mapping.get(raw, default)


def resolve_expense_status(status_value, reason: str = "", amount=None, allowed_limit=None, detected_amount=None, over_limit_by=None):
    base = canonical_status(status_value, "Flagged")
    rs = str(reason or "").strip().lower()

    parsed_allowed = parse_limit_value(allowed_limit)
    parsed_detected = parse_limit_value(detected_amount)
    parsed_over = parse_limit_value(over_limit_by)
    parsed_amount = parse_limit_value(amount)
    actual_amount = parsed_detected if parsed_detected is not None else parsed_amount

    explicit_over_limit = any(k in rs for k in [
        "over limit",
        "above limit",
        "exceeds limit",
        "exceeded limit",
    ])
    explicit_violation = any(
        k in rs for k in ["violates", "violation", "not compliant"])

    computed_over_limit = False
    if parsed_over is not None and parsed_over > 0:
        computed_over_limit = True
    elif parsed_allowed is not None and actual_amount is not None and actual_amount > parsed_allowed:
        computed_over_limit = True

    if base == "Approved" and (computed_over_limit or explicit_over_limit or explicit_violation):
        return "Rejected"

    return base


def build_policy_audit_prompt(policy_text: str, expense_payload: dict):
    return f"""
You are a strict expense policy auditor.

Company policy:
{policy_text}

Expense data:
{json.dumps(expense_payload, ensure_ascii=False)}

Decision rules (must follow):
1) Return status as one of exactly: Approved, Flagged, Rejected.
2) Do NOT randomly flag. Flag/Rejection only when you can point to an explicit policy rule or a concrete missing requirement.
3) If policy does not clearly prohibit this expense, prefer Approved.
4) If over a documented limit, mark Rejected (or Flagged only when policy explicitly says manager review).
5) Reason must be specific and include amount + compared policy limit whenever available.

Return JSON only with keys:
status, reason, policy_snippet, risk_level, rule_name, allowed_limit, detected_amount, over_limit_by

Formatting requirements for reason:
- One concise sentence, business readable.
- If a limit exists, use wording like: "Policy allows up to <currency><limit> for <category>; this expense is <currency><amount> (<currency><delta> over limit)."
- If approved, explicitly say why it complies.
"""


def build_trip_planner_prompt(policy_text: str, trip_payload: dict):
    return f"""
You are an enterprise travel policy copilot.
Your task is to generate a compliant pre-trip plan based on company policy and trip intent.

Company policy text:
{policy_text}

Trip request:
{json.dumps(trip_payload, ensure_ascii=False)}

Return JSON only with the exact keys:
transport_suggestions,
lodging_caps,
food_per_diem,
compliance_risk_summary,
compliance_score,
contextual_justification_prompts,
recommended_itinerary

Requirements:
1) Use policy-linked estimates where possible, especially for destination-specific limits.
2) compliance_score must be an integer from 0 to 100 (higher = likely approval).
3) compliance_risk_summary must be a list of concise bullets focused on likely rejection risks.
4) If user selected premium/last-minute options, add actionable prompts in contextual_justification_prompts.
5) recommended_itinerary should be a list of practical, compliant suggestions for the trip.
6) Keep recommendations concise, professional, and reimbursement-focused.

Shape constraints:
- transport_suggestions: list[str]
- lodging_caps: {{ "summary": str, "max_per_night": number|null, "currency": str|null }}
- food_per_diem: {{ "summary": str, "daily_limit": number|null, "client_entertainment_limit": number|null, "currency": str|null }}
- compliance_risk_summary: list[str]
- compliance_score: int
- contextual_justification_prompts: list[str]
- recommended_itinerary: list[str]
"""


def ensure_string_list(value):
    if isinstance(value, list):
        out = []
        for x in value:
            s = str(x).strip()
            if s:
                out.append(s)
        return out

    if isinstance(value, str):
        parts = re.split(r"[\n,•]+", value)
        return [p.strip(" -\t") for p in parts if p.strip(" -\t")]

    return []


def ensure_object(value):
    return value if isinstance(value, dict) else {}


def sanitize_paging(limit: int = 0, offset: int = 0, max_limit: int = 500):
    try:
        limit = int(limit or 0)
    except Exception:
        limit = 0
    try:
        offset = int(offset or 0)
    except Exception:
        offset = 0

    if limit < 0:
        limit = 0
    if offset < 0:
        offset = 0
    if limit > max_limit:
        limit = max_limit
    return limit, offset


def parse_limit_value(raw):
    if raw is None:
        return None
    try:
        return float(raw)
    except Exception:
        return parse_amount_value(raw)


def compose_reason(audit: dict, amount: float, currency: str, category: str):
    status = resolve_expense_status(
        audit.get("status"),
        reason=audit.get("reason"),
        amount=amount,
        allowed_limit=audit.get("allowed_limit"),
        detected_amount=audit.get("detected_amount"),
        over_limit_by=audit.get("over_limit_by"),
    )
    detected_amount = parse_limit_value(audit.get("detected_amount"))
    allowed_limit = parse_limit_value(audit.get("allowed_limit"))
    over_limit_by = parse_limit_value(audit.get("over_limit_by"))

    actual_amount = detected_amount if detected_amount is not None else float(
        amount or 0)
    curr = (currency or "USD").upper()
    cat = category or "this expense"

    if allowed_limit is not None:
        delta = over_limit_by
        if delta is None and actual_amount is not None:
            delta = max(actual_amount - allowed_limit, 0)

        if delta and delta > 0:
            return (
                f"Policy allows up to {curr} {allowed_limit:.2f} for {cat}; "
                f"this expense is {curr} {actual_amount:.2f} ({curr} {delta:.2f} over limit)."
            )

        if status == "Approved":
            return (
                f"This {cat} expense is within policy limit: {curr} {actual_amount:.2f} "
                f"against allowed {curr} {allowed_limit:.2f}."
            )

    fallback = str(audit.get("reason") or "").strip()
    if fallback:
        return fallback

    if status == "Approved":
        return "This expense complies with company policy based on category, amount, and business purpose."
    if status == "Rejected":
        return "This expense violates a clear policy rule and requires correction."
    return "This expense needs policy review due to missing or unclear policy-matching details."


def sync_claim_status_totals(claim_id: str):
    if not claim_id:
        return None

    exp_res = supabase.table("expenses").select(
        "amount,status,reason").eq("claim_id", claim_id).execute()
    items = exp_res.data or []
    total = sum(float(e.get("amount") or 0) for e in items)
    claim_status = derive_claim_status(items)

    updated = supabase.table("claims").update({
        "status": claim_status,
        "total_amount": total,
    }).eq("id", claim_id).execute()

    return updated.data[0] if updated.data else {"id": claim_id, "status": claim_status, "total_amount": total}


def enrich_claims_with_ai_summary(claims: list):
    if not claims:
        return claims

    claim_ids = [c.get("id") for c in claims if c.get("id")]
    if not claim_ids:
        return claims

    try:
        exp_res = (
            supabase.table("expenses")
            .select("claim_id,status,reason,policy_snippet,amount,currency,expense_type,vendor_name")
            .in_("claim_id", claim_ids)
            .execute()
        )
        rows = exp_res.data or []
    except Exception:
        return claims

    grouped = {}
    for r in rows:
        cid = r.get("claim_id")
        if not cid:
            continue
        r["status"] = resolve_expense_status(
            r.get("status"),
            reason=r.get("reason"),
            amount=r.get("amount"),
        )
        grouped.setdefault(cid, []).append(r)

    for claim in claims:
        items = grouped.get(claim.get("id"), [])
        if not items:
            claim["ai_summary"] = "No expense audit details available yet."
            claim["ai_policy_snippet"] = None
            continue

        # Do NOT overwrite the persisted claim status here.
        # The claim table status is authoritative (submit/override workflow).
        # We only expose derived item-level status as an additional hint.
        claim["derived_status"] = derive_claim_status(items)

        preferred = None
        for s in ("rejected", "flagged", "approved"):
            preferred = next((x for x in items if str(resolve_expense_status(
                x.get("status"),
                reason=x.get("reason"),
                amount=x.get("amount"),
            ) or "").strip().lower() == s), None)
            if preferred:
                break
        preferred = preferred or items[0]

        exp_type = preferred.get("expense_type") or "expense"
        vendor = preferred.get("vendor_name") or "vendor"
        amount = float(preferred.get("amount") or 0)
        currency = str(preferred.get("currency") or "USD")
        reason = str(preferred.get("reason") or "").strip()
        policy_snippet = preferred.get("policy_snippet")

        if reason:
            summary = reason
        else:
            st = canonical_status(preferred.get("status"), "Flagged")
            if st == "Approved":
                summary = f"Approved: {exp_type} from {vendor} ({currency} {amount:.2f}) complies with policy."
            elif st == "Rejected":
                summary = f"Rejected: {exp_type} from {vendor} ({currency} {amount:.2f}) violates a policy rule."
            else:
                summary = f"Flagged: {exp_type} from {vendor} ({currency} {amount:.2f}) needs policy review."

        claim["ai_summary"] = summary
        claim["ai_policy_snippet"] = policy_snippet

    return claims

# ───────────────── POLICY ─────────────────


@app.post("/upload-policy")
async def upload_policy(file: UploadFile = File(...), company_id: str = Form("default"), user=Depends(get_current_user)):
    pdf_bytes = await file.read()
    text = extract_text_from_pdf(pdf_bytes)

    if not text.strip():
        raise HTTPException(
            status_code=400,
            detail="No readable text found in the PDF. Upload a text-based policy PDF (not only scanned images)."
        )

    now_iso = datetime.utcnow().isoformat()
    supabase.table("policies").upsert({
        "company_id": company_id,
        "policy_text": text,
        "file_name": file.filename,
        "uploaded_at": now_iso
    }).execute()

    _policy_cache[str(company_id or "default")] = {
        "policy_text": text,
        "expires_at": time.time() + POLICY_CACHE_TTL_SECONDS,
        "uploaded_at": now_iso,
    }

    return {
        "success": True,
        "preview": text[:300],
        "file_name": file.filename,
        "uploaded_at": now_iso,
        "characters": len(text),
    }


@app.get("/policy/{company_id}")
async def fetch_policy(company_id: str, user=Depends(get_current_user)):
    record = get_policy_record(company_id)
    if not record:
        return {"exists": False, "policy": None}

    return {
        "exists": True,
        "policy": record.get("policy_text", ""),
        "file_name": record.get("file_name"),
        "uploaded_at": record.get("uploaded_at"),
        "preview": (record.get("policy_text") or "")[:300],
    }


@app.post("/trip-plans/generate")
async def generate_trip_plan(payload: dict = Body(...), user=Depends(get_current_user)):
    destination = str(payload.get("destination") or "").strip()
    start_date = str(payload.get("start_date") or "").strip()
    end_date = str(payload.get("end_date") or "").strip()
    business_purpose = str(payload.get("business_purpose") or "").strip()
    company_id = str(payload.get("company_id")
                     or "default").strip() or "default"

    activities = payload.get("activities") or []
    if isinstance(activities, str):
        activities = [x.strip() for x in activities.split(",") if x.strip()]
    if not isinstance(activities, list):
        activities = []

    expensive_choices = payload.get("expensive_choices") or []
    if not isinstance(expensive_choices, list):
        expensive_choices = []

    if not destination or not start_date or not end_date or not business_purpose:
        raise HTTPException(
            status_code=400, detail="destination, start_date, end_date and business_purpose are required")

    policy_text = get_policy(company_id)
    trip_request = {
        "destination": destination,
        "start_date": start_date,
        "end_date": end_date,
        "business_purpose": business_purpose,
        "activities": activities,
        "expensive_choices": expensive_choices,
    }

    policy_context = get_policy_context(policy_text, {
        "destination": destination,
        "business_purpose": business_purpose,
        "activities": activities,
    })
    prompt = build_trip_planner_prompt(policy_context, trip_request)

    try:
        llm_json = call_groq_json(
            messages=[{"role": "user", "content": prompt}],
            model=AUDIT_MODEL,
            max_tokens=TRIP_MAX_TOKENS,
            temperature=0.1,
            retries=AUDIT_RETRIES,
        )
    except Exception:
        llm_json = {
            "transport_suggestions": [
                "Use economy class for flights and standard rail fare unless policy allows exceptions.",
                "Prefer policy-approved local transport vendors and keep itemized receipts.",
            ],
            "lodging_caps": {
                "summary": f"Use the city lodging cap for {destination}; if no city cap exists, choose a mid-range business hotel.",
                "max_per_night": None,
                "currency": None,
            },
            "food_per_diem": {
                "summary": "Apply standard daily meal/per diem limits and separate client entertainment spends.",
                "daily_limit": None,
                "client_entertainment_limit": None,
                "currency": None,
            },
            "compliance_risk_summary": [
                "Policy AI was temporarily unavailable, so this plan is generated in safe fallback mode.",
                "Premium/last-minute bookings may require stronger justification.",
            ],
            "compliance_score": 55,
            "contextual_justification_prompts": [
                "Add business urgency and approval context for any premium option.",
            ],
            "recommended_itinerary": [
                "Book refundable compliant travel options first.",
                "Capture receipts with clear business purpose tagging.",
            ],
        }

    transport_suggestions = ensure_string_list(
        llm_json.get("transport_suggestions"))
    compliance_risk_summary = ensure_string_list(
        llm_json.get("compliance_risk_summary"))
    contextual_prompts = ensure_string_list(
        llm_json.get("contextual_justification_prompts"))
    recommended_itinerary = ensure_string_list(
        llm_json.get("recommended_itinerary"))

    lodging_caps = ensure_object(llm_json.get("lodging_caps"))
    food_per_diem = ensure_object(llm_json.get("food_per_diem"))

    try:
        compliance_score = int(float(llm_json.get("compliance_score", 0)))
    except Exception:
        compliance_score = 0
    compliance_score = max(0, min(100, compliance_score))

    normalized_plan = {
        "transport_suggestions": transport_suggestions,
        "lodging_caps": {
            "summary": str(lodging_caps.get("summary") or "No specific lodging guidance found in policy."),
            "max_per_night": parse_limit_value(lodging_caps.get("max_per_night")),
            "currency": lodging_caps.get("currency") or None,
        },
        "food_per_diem": {
            "summary": str(food_per_diem.get("summary") or "No specific meal/per diem guidance found in policy."),
            "daily_limit": parse_limit_value(food_per_diem.get("daily_limit")),
            "client_entertainment_limit": parse_limit_value(food_per_diem.get("client_entertainment_limit")),
            "currency": food_per_diem.get("currency") or None,
        },
        "compliance_risk_summary": compliance_risk_summary,
        "compliance_score": compliance_score,
        "contextual_justification_prompts": contextual_prompts,
        "recommended_itinerary": recommended_itinerary,
    }

    plan_row = {
        "id": str(uuid.uuid4()),
        "employee_id": str(user.id),
        "company_id": company_id,
        "destination": destination,
        "start_date": start_date,
        "end_date": end_date,
        "business_purpose": business_purpose,
        "activities": activities,
        "expensive_choices": expensive_choices,
        "ai_plan": normalized_plan,
        "compliance_score": compliance_score,
        "created_at": datetime.utcnow().isoformat(),
    }

    saved_ok = True
    save_warning = None
    try:
        saved = insert_travel_plan_with_schema_fallback(plan_row)
        saved_row = saved.data[0] if saved.data else plan_row
    except Exception as e:
        saved_ok = False
        save_warning = f"Trip plan generated but could not be saved. Ensure table 'travel_plans' exists. {str(e)}"
        saved_row = plan_row

    return {
        "plan": normalized_plan,
        "travel_plan": saved_row,
        "saved": saved_ok,
        "warning": save_warning,
    }


@app.get("/trip-plans/my")
async def my_trip_plans(user=Depends(get_current_user)):
    try:
        res = (
            supabase.table("travel_plans")
            .select("*")
            .eq("employee_id", str(user.id))
            .order("created_at", desc=True)
            .execute()
        )
        return {"plans": res.data or []}
    except Exception:
        return {"plans": []}

# ───────────────── OCR + AUDIT ─────────────────


@app.post("/extract-receipt")
async def extract_receipt(
    file: UploadFile = File(...),
    business_purpose: str = Form(""),
    employee_name: str = Form(""),
    company_id: str = Form("default"),
    claim_id: str = Form(""),
    user=Depends(get_current_user)
):
    try:
        content = await file.read()
        mime = (file.content_type or "image/jpeg").lower()

        # Save original upload
        ext = Path(file.filename or "receipt").suffix or (
            ".pdf" if "pdf" in mime else ".jpg"
        )
        fname = f"{uuid.uuid4()}{ext}"
        path = UPLOAD_DIR / fname
        path.write_bytes(content)
        image_url = f"/uploads/{fname}"

        ocr_prompt = """Extract receipt info as JSON:
{
  merchant_name,
  date,
  total_amount,
  currency,
  category,
  expense_type,
  payment_type,
  city,
  invoice_number,
  readable
}

Rules:
- Use ISO date when possible (YYYY-MM-DD).
- Use null if a field is not present.
"""

        # OCR for image or PDF
        if "pdf" in mime or ext.lower() == ".pdf":
            pdf_text = extract_text_from_pdf(
                content,
                max_pages=RECEIPT_PDF_MAX_PAGES,
                max_chars=RECEIPT_PDF_TEXT_MAX_CHARS,
            )
            if not pdf_text.strip():
                raise HTTPException(
                    status_code=400, detail="Could not read text from PDF receipt")

            extracted = call_groq_json(
                model=AUDIT_MODEL,
                messages=[{
                    "role": "user",
                    "content": f"{ocr_prompt}\n\nReceipt text:\n{pdf_text[:RECEIPT_PDF_TEXT_MAX_CHARS]}"
                }],
                temperature=0,
                max_tokens=OCR_MAX_TOKENS,
                retries=OCR_RETRIES,
            )
        else:
            image_b64 = base64.b64encode(content).decode()
            extracted = call_groq_json(
                model=OCR_MODEL,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": ocr_prompt},
                        {"type": "image_url", "image_url": {
                            "url": f"data:{mime};base64,{image_b64}"}}
                    ]
                }],
                temperature=0,
                max_tokens=OCR_MAX_TOKENS,
                retries=OCR_RETRIES,
            )

        normalized_amount = parse_amount_value(extracted.get("total_amount"))
        if normalized_amount is None:
            raise HTTPException(
                status_code=400,
                detail=f"Could not parse receipt amount: {extracted.get('total_amount')}"
            )
        normalized_currency = infer_currency_code(
            extracted.get("currency"),
            extracted.get("total_amount")
        )

        # AUDIT
        policy = get_policy(company_id)
        expense_payload = {
            "type": extracted.get("expense_type") or extracted.get("category"),
            "amount": normalized_amount,
            "currency": normalized_currency,
            "date": extracted.get("date"),
            "vendor": extracted.get("merchant_name"),
            "payment_type": extracted.get("payment_type"),
            "city": extracted.get("city"),
            "invoice_number": extracted.get("invoice_number"),
            "business_purpose": business_purpose,
        }
        policy_context = get_policy_context(policy, expense_payload)
        audit_prompt = build_policy_audit_prompt(
            policy_context, expense_payload)

        try:
            audit = call_groq_json(
                model=AUDIT_MODEL,
                messages=[{"role": "user", "content": audit_prompt}],
                temperature=0,
                max_tokens=AUDIT_MAX_TOKENS,
                retries=AUDIT_RETRIES,
            )
        except Exception:
            audit = {
                "status": "Flagged",
                "reason": "AI policy audit temporarily unavailable. Expense saved for manual review.",
                "policy_snippet": "Policy check unavailable",
                "risk_level": "Medium",
            }

        # SAVE
        expense = {
            "id": str(uuid.uuid4()),
            "employee_id": str(user.id),
            "employee_name": employee_name,
            "company_id": company_id,
            # Canonical/manual-entry aligned fields (for dashboard tables)
            "expense_type": extracted.get("expense_type") or extracted.get("category"),
            "transaction_date": extracted.get("date"),
            "vendor_name": extracted.get("merchant_name"),
            "city": extracted.get("city"),
            "payment_type": extracted.get("payment_type"),
            "invoice_number": extracted.get("invoice_number"),
            "receipt_url": image_url,
            # OCR-native fields (kept for compatibility)
            "merchant_name": extracted.get("merchant_name"),
            "date": extracted.get("date"),
            "amount": normalized_amount,
            "currency": normalized_currency,
            "category": extracted.get("category"),
            "business_purpose": business_purpose,
            "status": resolve_expense_status(
                audit.get("status"),
                reason=audit.get("reason"),
                amount=normalized_amount,
                allowed_limit=audit.get("allowed_limit"),
                detected_amount=audit.get("detected_amount"),
                over_limit_by=audit.get("over_limit_by"),
            ),
            "risk_level": audit.get("risk_level"),
            "reason": compose_reason(
                audit,
                normalized_amount,
                normalized_currency,
                extracted.get("expense_type") or extracted.get(
                    "category") or "expense"
            ),
            "policy_snippet": audit.get("policy_snippet"),
            "claim_id": claim_id or None,
            "image_url": image_url,
            "created_at": datetime.utcnow().isoformat()
        }

        insert_expense_with_schema_fallback(expense)
        if claim_id:
            sync_claim_status_totals(claim_id)
        return {"success": True, "data": expense}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Receipt processing failed: {str(e)}")

# ───────────────── CLAIMS ─────────────────


@app.post("/claims")
async def create_claim(
    report_name: str = Form(...),
    entity: str = Form(...),
    employee_name: str = Form(""),
    company_id: str = Form("default"),
    user=Depends(get_current_user)
):
    claim = {
        "id": str(uuid.uuid4()),
        "report_name": report_name,
        "entity": entity,
        "employee_id": str(user.id),
        "employee_name": employee_name,
        "company_id": company_id,
        "total_amount": 0,
        "status": "Draft",
        "created_at": datetime.utcnow().isoformat()
    }

    res = insert_claim_with_schema_fallback(claim)
    return {"claim": res.data[0]}


@app.get("/claims/my")
async def my_claims(limit: int = 0, offset: int = 0, user=Depends(get_current_user)):
    limit, offset = sanitize_paging(limit, offset)

    def build_base_query():
        q = supabase.table("claims").select(
            "*").eq("employee_id", str(user.id))
        if limit > 0:
            q = q.range(offset, offset + limit - 1)
        return q

    try:
        res = build_base_query().order("created_at", desc=True).execute()
    except Exception:
        try:
            res = build_base_query().order("id", desc=True).execute()
        except Exception:
            res = build_base_query().execute()

    items = enrich_claims_with_ai_summary(res.data or [])
    return {
        "claims": items,
        "paging": {
            "limit": limit,
            "offset": offset,
            "count": len(items),
            "total_count": None,
            "has_more": (limit > 0 and len(items) >= limit),
        }
    }


@app.get("/claims")
async def all_claims(user=Depends(get_current_user)):
    try:
        res = supabase.table("claims").select(
            "*").order("created_at", desc=True).execute()
    except Exception:
        try:
            res = supabase.table("claims").select(
                "*").order("id", desc=True).execute()
        except Exception:
            res = supabase.table("claims").select("*").execute()
    return {"claims": enrich_claims_with_ai_summary(res.data or [])}


@app.post("/claims/{claim_id}/submit")
async def submit_claim(claim_id: str, user=Depends(get_current_user)):
    res = supabase.table("expenses").select(
        "amount,status,reason").eq("claim_id", claim_id).execute()
    total = sum(float(e["amount"]) for e in res.data)
    claim_status = derive_claim_status(res.data)

    updated = supabase.table("claims").update({
        "status": claim_status,
        "total_amount": total,
        "submitted_at": datetime.utcnow().isoformat()
    }).eq("id", claim_id).execute()

    return {"success": True, "claim": updated.data[0] if updated.data else {"id": claim_id, "status": claim_status, "total_amount": total}}


@app.post("/claims/{claim_id}/override")
async def override_claim(
    claim_id: str,
    status: str = Body(..., embed=True),
    comment: str = Body("", embed=True),
    user=Depends(get_current_user)
):
    normalized_status = canonical_status(status, "")
    allowed = {"Approved", "Rejected", "Flagged"}
    if normalized_status not in allowed:
        raise HTTPException(status_code=400, detail="Invalid status")

    payload = {
        "status": normalized_status,
        "override_comment": comment or None,
        "overridden_at": datetime.utcnow().isoformat()
    }
    res = supabase.table("claims").update(payload).eq("id", claim_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Claim not found")

    return {"claim": res.data[0]}

# ───────────────── EXPENSES ─────────────────


@app.post("/expenses")
async def add_expense(
    expense_type: str = Form(...),
    amount: float = Form(...),
    transaction_date: str = Form(""),
    vendor_name: str = Form(""),
    currency: str = Form("USD"),
    city: str = Form(""),
    payment_type: str = Form(""),
    business_purpose: str = Form(""),
    gl_code: str = Form(""),
    invoice_number: str = Form(""),
    employee_name: str = Form(""),
    company_id: str = Form("default"),
    claim_id: str = Form(""),
    user=Depends(get_current_user)
):
    policy = get_policy(company_id)
    expense_payload = {
        "type": expense_type,
        "amount": amount,
        "currency": currency,
        "transaction_date": transaction_date,
        "vendor_name": vendor_name,
        "business_purpose": business_purpose,
        "city": city,
        "payment_type": payment_type,
        "invoice_number": invoice_number,
    }
    policy_context = get_policy_context(policy, expense_payload)
    audit_prompt = build_policy_audit_prompt(policy_context, expense_payload)

    try:
        audit = call_groq_json(
            model=AUDIT_MODEL,
            messages=[{"role": "user", "content": audit_prompt}],
            temperature=0,
            max_tokens=AUDIT_MAX_TOKENS,
            retries=AUDIT_RETRIES,
        )
    except Exception:
        audit = {
            "status": "Flagged",
            "reason": "Unable to validate against policy at this time.",
            "policy_snippet": "Policy check unavailable",
            "risk_level": "Medium",
        }

    expense = {
        "id": str(uuid.uuid4()),
        "employee_id": str(user.id),
        "employee_name": employee_name,
        "company_id": company_id,
        "expense_type": expense_type,
        "amount": amount,
        "currency": currency,
        "business_purpose": business_purpose or None,
        "status": resolve_expense_status(
            audit.get("status"),
            reason=audit.get("reason"),
            amount=amount,
            allowed_limit=audit.get("allowed_limit"),
            detected_amount=audit.get("detected_amount"),
            over_limit_by=audit.get("over_limit_by"),
        ),
        "risk_level": audit.get("risk_level", "Medium"),
        "reason": compose_reason(audit, amount, currency, expense_type),
        "policy_snippet": audit.get("policy_snippet"),
        "claim_id": claim_id or None,
        "created_at": datetime.utcnow().isoformat()
    }

    res = insert_expense_with_schema_fallback(expense)
    if claim_id:
        sync_claim_status_totals(claim_id)
    return {"expense": res.data[0]}


@app.get("/expenses")
async def list_expenses(claim_id: str = "", limit: int = 0, offset: int = 0, user=Depends(get_current_user)):
    limit, offset = sanitize_paging(limit, offset)
    q = supabase.table("expenses").select("*").eq("employee_id", str(user.id))
    if claim_id:
        q = q.eq("claim_id", claim_id)
    if limit > 0:
        q = q.range(offset, offset + limit - 1)

    try:
        res = q.order("created_at", desc=True).execute()
    except Exception:
        res = q.execute()

    items = res.data or []
    for item in items:
        item["status"] = resolve_expense_status(
            item.get("status"),
            reason=item.get("reason"),
            amount=item.get("amount"),
        )
    return {
        "expenses": items,
        "paging": {
            "limit": limit,
            "offset": offset,
            "count": len(items),
            "total_count": None,
            "has_more": (limit > 0 and len(items) >= limit),
        }
    }


@app.get("/expenses/available")
async def available_expenses(limit: int = 0, offset: int = 0, user=Depends(get_current_user)):
    limit, offset = sanitize_paging(limit, offset)
    q = supabase.table("expenses").select(
        "*").eq("employee_id", str(user.id)).is_("claim_id", "null")
    if limit > 0:
        q = q.range(offset, offset + limit - 1)

    try:
        res = q.order("created_at", desc=True).execute()
    except Exception:
        res = q.execute()

    items = res.data or []
    for item in items:
        item["status"] = resolve_expense_status(
            item.get("status"),
            reason=item.get("reason"),
            amount=item.get("amount"),
        )
    return {
        "expenses": items,
        "paging": {
            "limit": limit,
            "offset": offset,
            "count": len(items),
            "total_count": None,
            "has_more": (limit > 0 and len(items) >= limit),
        }
    }


@app.post("/expenses/{expense_id}/attach")
async def attach_expense(expense_id: str, claim_id: str = Form(...), user=Depends(get_current_user)):
    existing = supabase.table("expenses").select(
        "id,employee_id").eq("id", expense_id).single().execute()
    if not existing.data or existing.data.get("employee_id") != str(user.id):
        raise HTTPException(status_code=404, detail="Expense not found")

    res = supabase.table("expenses").update(
        {"claim_id": claim_id}).eq("id", expense_id).execute()
    sync_claim_status_totals(claim_id)
    return {"expense": res.data[0] if res.data else {"id": expense_id, "claim_id": claim_id}}

# ───────────────── APPROVALS ─────────────────


@app.get("/approvals")
async def approvals(user=Depends(get_current_user)):
    res = supabase.table("claims").select(
        "*").eq("status", "Pending Approval").execute()
    return {"approvals": res.data}

# ───────────────── HEALTH ─────────────────


@app.get("/health")
def health():
    return {"status": "ok"}
