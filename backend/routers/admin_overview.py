"""Organisation-wide overview for administrators.

Deliberately not the finance view with different labels. Finance asks "what is
waiting on my decision"; an administrator asks "is this organisation healthy" --
who is here, who is dormant, who cannot recover their own account, is anything
piling up unattended. Money appears only as volume, never as something to act
on, because an admin cannot approve or reject.
"""
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException

import config
from db import db, fetch_all_rows
from deps import Principal, require_admin

logger = logging.getLogger(__name__)

router = APIRouter()

DORMANT_AFTER_DAYS = 30
STALE_CLAIM_DAYS = 7


@router.get("/admin/overview")
def admin_overview(principal: Principal = Depends(require_admin)):
    """Headline numbers for the whole organisation."""
    company = principal.company_id

    def _profiles():
        return (db().table("profiles")
                .select("id,full_name,role,security_question,updated_at")
                .eq("company_id", company))

    def _claims():
        return (db().table("claims")
                .select("id,employee_id,employee_name,status,total_amount,"
                        "created_at,submitted_at,reimbursement_status")
                .eq("company_id", company))

    def _expenses():
        return (db().table("expenses")
                .select("id,employee_id,status,amount,amount_base,currency,"
                        "created_at,receipt_missing,citation_verified")
                .eq("company_id", company))

    try:
        people = fetch_all_rows(_profiles)
        claims = fetch_all_rows(_claims)
        expenses = fetch_all_rows(_expenses)
    except Exception:
        logger.exception("admin overview failed for %s", company)
        raise HTTPException(
            status_code=503, detail="Could not load the organisation overview.")

    now = datetime.utcnow()
    dormant_before = (now - timedelta(days=DORMANT_AFTER_DAYS)).isoformat()
    stale_before = (now - timedelta(days=STALE_CLAIM_DAYS)).isoformat()

    # ── people ──────────────────────────────────────────────────────────
    by_role = {}
    for p in people:
        role = str(p.get("role") or "employee").strip().lower()
        by_role[role] = by_role.get(role, 0) + 1

    # Last activity per person, from their own rows rather than a login
    # timestamp -- Supabase keeps that in auth, and reading it per user would
    # cost a round trip each.
    last_seen = {}
    for row in list(claims) + list(expenses):
        uid = str(row.get("employee_id") or "")
        stamp = str(row.get("submitted_at") or row.get("created_at") or "")
        if uid and stamp > last_seen.get(uid, ""):
            last_seen[uid] = stamp

    dormant = [
        {"id": p["id"], "full_name": p.get("full_name"),
         "role": str(p.get("role") or "employee").strip().lower(),
         "last_active": last_seen.get(str(p["id"]))}
        for p in people
        if last_seen.get(str(p["id"]), "") < dormant_before
    ]
    no_recovery = [
        {"id": p["id"], "full_name": p.get("full_name")}
        for p in people if not p.get("security_question")
    ]

    # ── claims ──────────────────────────────────────────────────────────
    claims_by_status = {}
    for c in claims:
        label = str(c.get("status") or "Draft")
        claims_by_status[label] = claims_by_status.get(label, 0) + 1

    pending = [c for c in claims if c.get("status") == "Pending Approval"]
    # Submitted but still undecided a week later. This is the number an
    # administrator can act on -- by finding out why nobody is approving.
    stalled = [c for c in pending
               if str(c.get("submitted_at") or c.get("created_at") or "") < stale_before]

    approved = [c for c in claims if c.get("status") == "Approved"]
    unpaid = [c for c in approved
              if str(c.get("reimbursement_status") or "Not started") != "Paid"]

    # ── expenses ────────────────────────────────────────────────────────
    unconverted = [e for e in expenses if e.get("amount_base") is None]
    unconverted_currencies = sorted({
        str(e.get("currency") or "UNKNOWN").upper() for e in unconverted})

    return {
        "company_id": company,
        "base_currency": config.BASE_CURRENCY,
        "generated_at": now.isoformat(),
        "people": {
            "total": len(people),
            "by_role": by_role,
            "approvers": by_role.get("manager", 0) + by_role.get("finance", 0),
            "administrators": by_role.get("admin", 0),
            "active_30d": len(people) - len(dormant),
            "dormant": sorted(dormant, key=lambda d: d["last_active"] or "")[:10],
            "dormant_count": len(dormant),
            "without_recovery": no_recovery[:10],
            "without_recovery_count": len(no_recovery),
        },
        "claims": {
            "total": len(claims),
            "by_status": claims_by_status,
            "awaiting_decision": len(pending),
            "stalled": len(stalled),
            "stalled_days": STALE_CLAIM_DAYS,
            "approved_unpaid": len(unpaid),
            "approved_unpaid_value": round(
                sum(float(c.get("total_amount") or 0) for c in unpaid), 2),
        },
        "expenses": {
            "total": len(expenses),
            "volume": round(sum(float(e.get("amount_base") or 0) for e in expenses), 2),
            "missing_receipts": sum(1 for e in expenses if e.get("receipt_missing")),
            "unverified_citations": sum(
                1 for e in expenses if e.get("citation_verified") is False),
            "unconverted": len(unconverted),
            "unconverted_currencies": unconverted_currencies,
        },
    }
