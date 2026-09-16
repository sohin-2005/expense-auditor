import logging
import uuid
from datetime import datetime
from fastapi import APIRouter, Body, Depends, Form, HTTPException
from db import db, insert_row
from deps import (Principal, get_current_user, get_principal, load_claim_in_company,
                  load_own_claim, require_finance, require_submitter)
from domain.money import CLAIM_SYNC_COLUMNS, claim_total_base
from domain.status import canonical_status, derive_claim_status
from domain.util import sanitize_paging
from services.claims import enrich_claims_with_ai_summary

logger = logging.getLogger(__name__)

router = APIRouter()


# ───────────────── CLAIMS ─────────────────


@router.post("/claims")
def create_claim(
    report_name: str = Form(...),
    entity: str = Form(...),
    employee_name: str = Form(""),
    company_id: str = Form("default"),
    principal: Principal = Depends(require_submitter)
):
    # Claims belong to the caller's company, not to whatever the form said --
    # otherwise a claim can be filed into another company's approval queue.
    company_id = principal.company_id
    user = principal.user
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

    res = insert_row("claims", claim, "Claim")
    return {"claim": res.data[0]}


@router.get("/claims/my")
def my_claims(limit: int = 0, offset: int = 0, user=Depends(get_current_user)):
    limit, offset = sanitize_paging(limit, offset)

    def build_base_query():
        q = db().table("claims").select(
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


@router.get("/claims")
def all_claims(limit: int = 0, offset: int = 0,
               principal: Principal = Depends(require_finance)):
    # Was: every claim in the database, to anyone with a token. Now approvers
    # only, and only within their own company.
    limit, offset = sanitize_paging(limit, offset)
    if limit <= 0:
        # An unbounded read here silently stopped at PostgREST's 1000-row cap,
        # so an approver at a busy company saw a prefix of the queue and no
        # sign that anything was missing. A real default beats a silent one.
        limit = 200

    def base():
        return (
            db().table("claims").select("*")
            .eq("company_id", principal.company_id)
            .range(offset, offset + limit - 1)
        )

    try:
        res = base().order("created_at", desc=True).execute()
    except Exception:
        logger.warning(
            "claims ordering by created_at failed; falling back to id", exc_info=True)
        res = base().order("id", desc=True).execute()

    items = enrich_claims_with_ai_summary(res.data or [])
    return {
        "claims": items,
        "paging": {
            "limit": limit,
            "offset": offset,
            "count": len(items),
            "has_more": len(items) >= limit,
        },
    }


@router.post("/claims/{claim_id}/submit")
def submit_claim(claim_id: str, principal: Principal = Depends(get_principal)):
    # Submitting somebody else's claim moves it out of their control, so
    # ownership is checked here even though this is not a privileged action.
    load_own_claim(claim_id, principal)

    res = db().table("expenses").select(
        CLAIM_SYNC_COLUMNS).eq("claim_id", claim_id).execute()
    items = res.data or []
    if not items:
        raise HTTPException(
            status_code=400,
            detail="Add at least one expense before submitting this claim.")

    total = claim_total_base(items)

    # Submitting sends a claim TO a person; it does not decide it.
    #
    # This used to write derive_claim_status(), which returns "Approved" when
    # every expense cleared the AI audit -- so a claim could be approved with
    # no human ever seeing it, and /approvals (which filters on "Pending
    # Approval") stayed permanently empty because nothing ever wrote that
    # value. An AI verdict is a strong hint about a line item, not authority
    # to release company money.
    #
    # The expense-derived verdict is still computed and returned, and
    # enrich_claims_with_ai_summary exposes it as `derived_status` so an
    # approver sees "the audit thinks this is fine" without it being decided
    # for them.
    derived = derive_claim_status(items)

    updated = db().table("claims").update({
        "status": "Pending Approval",
        "total_amount": total,
        "submitted_at": datetime.utcnow().isoformat()
    }).eq("id", claim_id).execute()

    claim = (updated.data[0] if updated.data
             else {"id": claim_id, "status": "Pending Approval", "total_amount": total})
    return {"success": True, "claim": claim, "derived_status": derived,
            "expenses": len(items)}


@router.post("/claims/{claim_id}/override")
def override_claim(
    claim_id: str,
    status: str = Body(..., embed=True),
    comment: str = Body("", embed=True),
    principal: Principal = Depends(require_finance),
):
    normalized_status = canonical_status(status, "")
    allowed = {"Approved", "Rejected", "Flagged"}
    if normalized_status not in allowed:
        raise HTTPException(status_code=400, detail="Invalid status")

    # Approving is the single most abusable action in the service. Two gates:
    # require_finance above rejects employees outright, and the company check
    # below stops a manager at one company deciding another company's claims.
    claim = load_claim_in_company(claim_id, principal.company_id)

    # An approver deciding their own claim defeats the point of approval.
    if str(claim.get("employee_id") or "") == principal.id:
        raise HTTPException(
            status_code=403,
            detail="You cannot override your own claim. Ask another approver.",
        )

    payload = {
        "status": normalized_status,
        "override_comment": comment or None,
        "overridden_at": datetime.utcnow().isoformat()
    }
    res = db().table("claims").update(payload).eq("id", claim_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Claim not found")

    logger.info(
        "claim override claim=%s by=%s role=%s status=%s",
        claim_id, principal.id, principal.role, normalized_status,
    )
    return {"claim": res.data[0]}


@router.get("/approvals")
def approvals(principal: Principal = Depends(require_finance)):
    res = (
        db().table("claims").select("*")
        .eq("status", "Pending Approval")
        .eq("company_id", principal.company_id)
        .order("submitted_at", desc=False)
        .execute()
    )
    # Enriched so the approver sees what the audit concluded about each claim's
    # expenses -- derived_status, a one-line summary and the cited policy
    # passage -- alongside the claim itself. It is guidance on the screen, not
    # a decision in the database: the claim's own status stays "Pending
    # Approval" until a person changes it.
    return {"approvals": enrich_claims_with_ai_summary(res.data or [])}


REIMBURSEMENT_STATES = ("Not started", "Scheduled", "Paid")


@router.post("/claims/{claim_id}/reimbursement")
def set_reimbursement(
    claim_id: str,
    status: str = Body(..., embed=True),
    reference: str = Body("", embed=True),
    principal: Principal = Depends(require_finance),
):
    """Record where an approved claim is in the payment run.

    Approved is not the same as paid, and the gap between them is where "when
    do I get my money" lives — the question an expense tool gets asked more
    than any other. Tracking it separately from the approval verdict is what
    lets the app answer it instead of the employee emailing finance.
    """
    normalized = str(status or "").strip().title()
    if normalized not in REIMBURSEMENT_STATES:
        raise HTTPException(
            status_code=400,
            detail=f"Reimbursement status must be one of: {', '.join(REIMBURSEMENT_STATES)}.")

    claim = load_claim_in_company(claim_id, principal.company_id)

    # Paying out something that was never approved is the mistake this guard
    # exists for; it is easy to make from a list view.
    if normalized != "Not started" and str(claim.get("status")) != "Approved":
        raise HTTPException(
            status_code=400,
            detail=f"This claim is {claim.get('status')}, not Approved. "
                   "Approve it before scheduling payment.")

    payload = {"reimbursement_status": normalized,
               "reimbursement_reference": (reference or "").strip() or None}
    if normalized == "Paid":
        payload["reimbursed_at"] = datetime.utcnow().isoformat()

    res = db().table("claims").update(payload).eq("id", claim_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Claim not found")

    logger.info("reimbursement %s claim=%s by=%s", normalized, claim_id, principal.id)
    return {"success": True, "claim": res.data[0]}
