import logging
import uuid
import base64
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Response, UploadFile
from ai_provider import AIUnavailableError, TEXT, VISION, call_ai_json
from config import AUDIT_MAX_TOKENS, OCR_MAX_TOKENS, RECEIPT_PDF_MAX_PAGES, RECEIPT_PDF_TEXT_MAX_CHARS, RECEIPT_URL_TTL_SECONDS
from db import db, fetch_all_rows, insert_row, offload
from deps import (Principal, get_current_user, get_principal, load_own_claim,
                  require_submitter)
from domain.duplicates import apply_duplicate_check
from domain import mileage
from domain.money import apply_fx, infer_currency_code, parse_amount_value
from domain.status import compose_reason, resolve_expense_status
from domain.util import sanitize_paging
from services.audit import apply_citation, build_policy_audit_prompt
from services.claims import sync_claim_status_totals
from services.policy import build_policy_context, get_policy
from services.receipts import extract_text_from_pdf, resolve_receipt_url, store_receipt

logger = logging.getLogger(__name__)

router = APIRouter()


# ───────────────── OCR + AUDIT ─────────────────


@router.post("/extract-receipt")
async def extract_receipt(
    file: UploadFile = File(...),
    business_purpose: str = Form(""),
    employee_name: str = Form(""),
    company_id: str = Form("default"),
    claim_id: str = Form(""),
    principal: Principal = Depends(require_submitter)
):
    # Which company's policy audits this receipt is not the client's choice.
    company_id = principal.company_id
    user = principal.user
    if claim_id:
        await offload(load_own_claim, claim_id, principal)
    try:
        content = await file.read()
        mime = (file.content_type or "image/jpeg").lower()
        ext = Path(file.filename or "receipt").suffix or (
            ".pdf" if "pdf" in mime else ".jpg"
        )

        # Save the original upload. Returns a bucket object path, or a
        # /uploads/ path if no bucket is reachable.
        image_url = await offload(store_receipt, content, file.filename or "receipt", mime)

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
            pdf_text = await offload(
                extract_text_from_pdf,
                content,
                max_pages=RECEIPT_PDF_MAX_PAGES,
                max_chars=RECEIPT_PDF_TEXT_MAX_CHARS,
            )
            if not pdf_text.strip():
                raise HTTPException(
                    status_code=400, detail="Could not read text from PDF receipt")

            extracted = await call_ai_json(
                messages=[{
                    "role": "user",
                    "content": f"{ocr_prompt}\n\nReceipt text:\n{pdf_text[:RECEIPT_PDF_TEXT_MAX_CHARS]}"
                }],
                task=TEXT,
                max_tokens=OCR_MAX_TOKENS,
                temperature=0,
            )
        else:
            image_b64 = base64.b64encode(content).decode()
            extracted = await call_ai_json(
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": ocr_prompt},
                        {"type": "image_url", "image_url": {
                            "url": f"data:{mime};base64,{image_b64}"}}
                    ]
                }],
                task=VISION,
                max_tokens=OCR_MAX_TOKENS,
                temperature=0,
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
        policy = await offload(get_policy, company_id)
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
        policy_context, retrieved = await build_policy_context(
            company_id, policy, expense_payload)
        audit_prompt = build_policy_audit_prompt(
            policy_context, expense_payload, cited=bool(retrieved))

        try:
            audit = await call_ai_json(
                messages=[{"role": "user", "content": audit_prompt}],
                task=TEXT,
                max_tokens=AUDIT_MAX_TOKENS,
                temperature=0,
            )
            audit = apply_citation(audit, retrieved)
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
            # Provenance: which chunk of which policy version justified this,
            # and whether that citation was actually verifiable.
            "policy_chunk_id": audit.get("policy_chunk_id"),
            "policy_section": audit.get("policy_section"),
            "citation_verified": audit.get("citation_verified"),
            "claim_id": claim_id or None,
            "image_url": image_url,
            "created_at": datetime.utcnow().isoformat()
        }

        expense = await offload(apply_fx, expense)
        expense = await offload(apply_duplicate_check, expense)
        duplicate_of = expense.pop("duplicate_of", None)
        await offload(insert_row, "expenses", expense, "Expense")
        if claim_id:
            await offload(sync_claim_status_totals, claim_id)
        return {"success": True, "data": expense, "duplicate_of": duplicate_of}

    except HTTPException:
        raise
    except AIUnavailableError as e:
        # A provider outage is not the caller's fault and is not permanent.
        # Say so precisely; a generic 500 sent users hunting for bugs that
        # were never in their receipt.
        logger.error("receipt AI unavailable task=%s failures=%s", e.task, e.failures)
        if e.task == VISION:
            detail = ("Image scanning is temporarily unavailable — please try "
                      "again shortly, or upload a PDF receipt.")
        else:
            detail = ("Receipt processing is temporarily unavailable — please "
                      "try again shortly.")
        raise HTTPException(status_code=503, detail=detail)
    except Exception as e:
        # Genuinely unexpected. Log the detail server-side; do not leak
        # internals such as database constraint names to the client.
        logger.exception("receipt processing failed")
        raise HTTPException(
            status_code=500,
            detail="Receipt processing failed unexpectedly. Please try again.")


# ───────────────── EXPENSES ─────────────────


@router.post("/expenses")
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
    principal: Principal = Depends(require_submitter)
):
    company_id = principal.company_id
    user = principal.user
    if claim_id:
        await offload(load_own_claim, claim_id, principal)
    policy = await offload(get_policy, company_id)
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
    policy_context, retrieved = await build_policy_context(
        company_id, policy, expense_payload)
    audit_prompt = build_policy_audit_prompt(
        policy_context, expense_payload, cited=bool(retrieved))

    try:
        audit = await call_ai_json(
            messages=[{"role": "user", "content": audit_prompt}],
            task=TEXT,
            max_tokens=AUDIT_MAX_TOKENS,
            temperature=0,
        )
        audit = apply_citation(audit, retrieved)
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
        "policy_chunk_id": audit.get("policy_chunk_id"),
        "policy_section": audit.get("policy_section"),
        "citation_verified": audit.get("citation_verified"),
        "claim_id": claim_id or None,
        "created_at": datetime.utcnow().isoformat()
    }

    expense = await offload(apply_fx, expense)
    expense = await offload(apply_duplicate_check, expense)
    duplicate_of = expense.pop("duplicate_of", None)
    res = await offload(insert_row, "expenses", expense, "Expense")
    if claim_id:
        await offload(sync_claim_status_totals, claim_id)
    return {"expense": res.data[0], "duplicate_of": duplicate_of}


@router.get("/expenses")
def list_expenses(claim_id: str = "", limit: int = 0, offset: int = 0, user=Depends(get_current_user)):
    limit, offset = sanitize_paging(limit, offset)
    q = db().table("expenses").select("*").eq("employee_id", str(user.id))
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


@router.get("/expenses/available")
def available_expenses(limit: int = 0, offset: int = 0, user=Depends(get_current_user)):
    limit, offset = sanitize_paging(limit, offset)
    q = db().table("expenses").select(
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


@router.post("/expenses/{expense_id}/attach")
def attach_expense(expense_id: str, claim_id: str = Form(...), principal: Principal = Depends(get_principal)):
    existing = db().table("expenses").select(
        "id,employee_id").eq("id", expense_id).single().execute()
    if not existing.data or existing.data.get("employee_id") != principal.id:
        raise HTTPException(status_code=404, detail="Expense not found")

    # The expense being the caller's was already checked; the claim being the
    # caller's was not. Without this, an employee could attach their expense
    # to a stranger's claim and silently change that claim's total and status.
    load_own_claim(claim_id, principal)

    res = db().table("expenses").update(
        {"claim_id": claim_id}).eq("id", expense_id).execute()
    sync_claim_status_totals(claim_id)
    return {"expense": res.data[0] if res.data else {"id": expense_id, "claim_id": claim_id}}


@router.get("/receipts/{expense_id}")
def receipt_link(expense_id: str, principal: Principal = Depends(get_principal)):
    """A short-lived URL for one receipt image.

    Receipts used to be served straight off the `/uploads` static mount, which
    means anyone holding a URL could read anyone's receipt with no token at
    all. Access is checked here instead: the owner, or an approver in the same
    company who may legitimately need to see what they are approving.
    """
    try:
        res = (
            db().table("expenses")
            .select("id,employee_id,company_id,receipt_url,image_url")
            .eq("id", expense_id)
            .limit(1)
            .execute()
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("receipt lookup failed for expense %s", expense_id)
        raise HTTPException(
            status_code=503, detail="Could not load that receipt. Try again shortly.")

    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Receipt not found")
    row = rows[0]

    is_owner = str(row.get("employee_id") or "") == principal.id
    same_company = str(row.get("company_id") or "default") == principal.company_id
    if not (is_owner or (principal.is_privileged and same_company)):
        raise HTTPException(status_code=404, detail="Receipt not found")

    stored = row.get("receipt_url") or row.get("image_url")
    url = resolve_receipt_url(stored)
    if not url:
        raise HTTPException(
            status_code=404,
            detail="This receipt is no longer available. Receipts uploaded before "
                   "object storage was enabled are lost when the server restarts.",
        )
    return {"url": url, "expires_in": RECEIPT_URL_TTL_SECONDS}


# ───────────────── EXPENSE MANAGEMENT EXTRAS ─────────────────


@router.delete("/expenses/{expense_id}")
def delete_expense(expense_id: str, user=Depends(get_current_user)):
    existing = db().table("expenses").select(
        "id,employee_id,claim_id").eq("id", expense_id).single().execute()
    if not existing.data or existing.data.get("employee_id") != str(user.id):
        raise HTTPException(status_code=404, detail="Expense not found")

    claim_id = existing.data.get("claim_id")
    db().table("expenses").delete().eq("id", expense_id).execute()
    if claim_id:
        sync_claim_status_totals(claim_id)
    return {"success": True, "deleted": expense_id}


@router.post("/expenses/{expense_id}/detach")
def detach_expense(expense_id: str, user=Depends(get_current_user)):
    existing = db().table("expenses").select(
        "id,employee_id,claim_id").eq("id", expense_id).single().execute()
    if not existing.data or existing.data.get("employee_id") != str(user.id):
        raise HTTPException(status_code=404, detail="Expense not found")

    claim_id = existing.data.get("claim_id")
    res = db().table("expenses").update(
        {"claim_id": None}).eq("id", expense_id).execute()
    if claim_id:
        sync_claim_status_totals(claim_id)
    return {"expense": res.data[0] if res.data else {"id": expense_id, "claim_id": None}}


@router.get("/expenses/export.csv")
def export_expenses_csv(user=Depends(get_current_user)):
    """Download the current user's expenses as a CSV file."""
    # Paged: a bare .execute() stops at 1000 rows without saying so, which
    # made a partial export look like a complete one.
    def _page():
        return (
            db().table("expenses").select("*")
            .eq("employee_id", str(user.id))
            .order("created_at", desc=True)
        )

    try:
        rows = fetch_all_rows(_page)
    except Exception:
        logger.exception("CSV export query failed for user %s", user.id)
        raise HTTPException(
            status_code=503,
            detail="Could not build your export right now. Please try again shortly.",
        )

    cols = ["transaction_date", "expense_type", "vendor_name", "city",
            "amount", "currency", "amount_base", "base_currency", "fx_rate",
            "payment_type", "business_purpose",
            "invoice_number", "status", "risk_level", "reason", "claim_id", "created_at"]

    def esc(v):
        s = "" if v is None else str(v)
        if any(c in s for c in [",", '"', "\n"]):
            s = '"' + s.replace('"', '""') + '"'
        return s

    lines = [",".join(cols)]
    for r in rows:
        r["status"] = resolve_expense_status(
            r.get("status"), reason=r.get("reason"), amount=r.get("amount"))
        r["vendor_name"] = r.get("vendor_name") or r.get("merchant_name")
        r["transaction_date"] = r.get("transaction_date") or r.get("date")
        r["expense_type"] = r.get("expense_type") or r.get("category")
        lines.append(",".join(esc(r.get(c)) for c in cols))

    csv_text = "\n".join(lines)
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=audixa_expenses.csv"},
    )


@router.post("/expenses/mileage")
async def add_mileage_expense(
    distance: float = Form(...),
    unit: str = Form("km"),
    transaction_date: str = Form(""),
    business_purpose: str = Form(...),
    from_location: str = Form(""),
    to_location: str = Form(""),
    cost_center: str = Form(""),
    project_code: str = Form(""),
    employee_name: str = Form(""),
    claim_id: str = Form(""),
    principal: Principal = Depends(require_submitter),
):
    """Claim a journey by distance rather than by receipt.

    No AI call at all. There is nothing to OCR and no judgement to make: the
    amount is distance times the company's published rate, so it is computed
    here where it is exact, free and instant. Refused outright when no rate is
    on file — reimbursing at an invented number would be worse than refusing.
    """
    unit = (unit or "km").strip().lower()
    if unit not in mileage.VALID_UNITS:
        raise HTTPException(
            status_code=400, detail="Distance unit must be 'km' or 'mi'.")
    try:
        dist = float(distance)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Distance must be a number.")
    if dist <= 0:
        raise HTTPException(status_code=400, detail="Distance must be greater than zero.")
    if dist > mileage.MAX_REASONABLE_DISTANCE:
        raise HTTPException(
            status_code=400,
            detail=f"{dist:g}{unit} looks like a typo for a single journey. "
                   "Split it into legs if it is genuine.")

    if claim_id:
        await offload(load_own_claim, claim_id, principal)

    rate_row = await offload(mileage.get_mileage_rate, principal.company_id, unit)
    if not rate_row:
        raise HTTPException(
            status_code=409,
            detail=f"No mileage rate is set for {unit}. Ask your finance team to "
                   "add one before claiming mileage.")

    computed = mileage.compute_mileage(dist, unit, rate_row)
    route = " → ".join([p for p in (from_location.strip(), to_location.strip()) if p])

    expense = {
        "id": str(uuid.uuid4()),
        "employee_id": principal.id,
        "employee_name": employee_name,
        "company_id": principal.company_id,
        "expense_type": "Mileage",
        "category": "Mileage",
        "amount": computed["amount"],
        "currency": computed["currency"],
        "transaction_date": transaction_date or None,
        "vendor_name": route or "Personal vehicle",
        "business_purpose": business_purpose,
        "distance": computed["distance"],
        "distance_unit": computed["distance_unit"],
        "mileage_rate": computed["mileage_rate"],
        "cost_center": cost_center or None,
        "project_code": project_code or None,
        # A computed amount is not a policy judgement. It is Approved because
        # the arithmetic is the rule; a policy cap on total mileage is a
        # separate question finance answers at claim level.
        "status": "Approved",
        "risk_level": "Low",
        "reason": (f"Mileage: {computed['distance']:g}{unit} at "
                   f"{computed['currency']} {computed['mileage_rate']}/{unit} "
                   f"= {computed['currency']} {computed['amount']:.2f}."),
        "policy_snippet": f"Company mileage rate, effective {rate_row.get('effective_from')}.",
        "receipt_missing": False,
        "claim_id": claim_id or None,
        "created_at": datetime.utcnow().isoformat(),
    }

    expense = await offload(apply_fx, expense)
    res = await offload(insert_row, "expenses", expense, "Mileage expense")
    if claim_id:
        await offload(sync_claim_status_totals, claim_id)

    return {"expense": res.data[0] if res.data else expense, "computed": computed}


@router.get("/expenses/mileage-rate")
def mileage_rate(unit: str = "km", principal: Principal = Depends(get_principal)):
    """Whether mileage can be claimed, and at what rate.

    The form asks before it renders, so an employee is told the rate is
    missing rather than discovering it after typing out a journey.
    """
    row = mileage.get_mileage_rate(principal.company_id, unit)
    if not row:
        return {"available": False, "unit": unit,
                "detail": "No mileage rate has been set for your company."}
    return {"available": True, **row}


@router.post("/expenses/{expense_id}/missing-receipt")
def declare_missing_receipt(
    expense_id: str,
    reason: str = Body(..., embed=True),
    principal: Principal = Depends(get_principal),
):
    """Declare that a receipt is genuinely unavailable.

    Receipts get lost. Without a path for it people either fabricate one or
    absorb the cost quietly, and neither is visible to finance. Recording it
    as a fact on the row -- rather than as a sentence buried in
    business_purpose -- is what makes the pattern reportable.

    It does not approve anything: the expense is flagged for human review,
    because an unevidenced claim is exactly what a person should look at.
    """
    text = str(reason or "").strip()
    if len(text) < 10:
        raise HTTPException(
            status_code=400,
            detail="Explain briefly what happened to the receipt — finance reviews these.")
    if len(text) > 600:
        text = text[:600]

    existing = (
        db().table("expenses")
        .select("id,employee_id,claim_id,receipt_url,status")
        .eq("id", expense_id).limit(1).execute().data or []
    )
    if not existing or str(existing[0].get("employee_id") or "") != principal.id:
        raise HTTPException(status_code=404, detail="Expense not found")
    if existing[0].get("receipt_url"):
        raise HTTPException(
            status_code=400,
            detail="This expense already has a receipt attached.")

    res = (
        db().table("expenses")
        .update({
            "receipt_missing": True,
            "missing_receipt_reason": text,
            "status": "Flagged",
            "risk_level": "Medium",
            "reason": "No receipt provided; employee declaration recorded. "
                      "Requires manual review.",
        })
        .eq("id", expense_id).execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Expense not found")

    claim_id = existing[0].get("claim_id")
    if claim_id:
        sync_claim_status_totals(claim_id)

    logger.info("missing receipt declared expense=%s by=%s", expense_id, principal.id)
    return {"success": True, "expense": res.data[0]}
