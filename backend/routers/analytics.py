import logging
from fastapi import APIRouter, Depends, HTTPException
import config
from config import BASE_CURRENCY
from db import db, fetch_all_rows
from deps import Principal, get_principal, require_finance

logger = logging.getLogger(__name__)

router = APIRouter()


# ───────────────── ANALYTICS ─────────────────


@router.get("/analytics/summary")
def analytics_summary(scope: str = "my", principal: Principal = Depends(get_principal)):
    """Spend analytics: totals by status/category/month, top vendors, compliance rate."""
    # Scope is decided by the caller's role, not by the query parameter. The
    # parameter used to be the whole gate: `scope=all` skipped the
    # employee_id filter, so any employee could read company-wide spend.
    #
    # An employee asking for scope=all now gets their own data rather than a
    # 403, so the UI needs no role branching and an over-eager link degrades
    # instead of erroring.
    company_wide = (scope == "all") and principal.is_privileged

    # Aggregated in Postgres (db/004_analytics.sql), not in a Python loop over
    # every row. The loop had no .limit(), and PostgREST silently caps a
    # response at 1000 rows with a plain HTTP 200 -- so past a thousand
    # expenses every number here was quietly wrong.
    try:
        res = db().rpc("analytics_summary", {
            "p_company_id": principal.company_id,
            "p_employee_id": None if company_wide else principal.id,
        }).execute()
        summary = res.data
    except Exception:
        logger.exception(
            "analytics_summary RPC failed (company=%s, company_wide=%s)",
            principal.company_id, company_wide,
        )
        raise HTTPException(
            status_code=503,
            detail="Analytics are temporarily unavailable. If this persists, check "
                   "that backend/db/004_analytics.sql has been applied.",
        )

    # PostgREST hands a scalar-returning function back either bare or wrapped
    # in a single-row list depending on version.
    if isinstance(summary, list):
        summary = summary[0] if summary else None
    if not isinstance(summary, dict):
        summary = {}

    empty_status = {"Approved": 0, "Flagged": 0, "Rejected": 0}
    by_status = {**empty_status, **(summary.get("by_status") or {})}
    status_amounts = {
        **{k: 0.0 for k in empty_status},
        **(summary.get("status_amounts") or {}),
    }

    return {
        # Say which scope was actually applied. The client asks for one and
        # the server decides, so the UI must label what it got rather than
        # what it requested.
        "scope": "company" if company_wide else "mine",
        # Amounts are in the base currency; see db/003_fx.sql. `unconverted`
        # reports what could not be converted instead of folding it in at an
        # implied 1:1, which is what made a Rs.5,000 taxi and a $5,000 flight
        # count equally.
        "base_currency": BASE_CURRENCY,
        "unconverted": summary.get("unconverted") or {
            "count": 0, "original_amount": 0, "currencies": []},
        "total_expenses": summary.get("total_expenses", 0),
        "total_amount": summary.get("total_amount", 0),
        "compliance_rate": summary.get("compliance_rate", 0),
        "by_status": by_status,
        "status_amounts": status_amounts,
        "top_categories": summary.get("top_categories") or [],
        "top_vendors": summary.get("top_vendors") or [],
        "monthly": summary.get("monthly") or [],
    }


@router.get("/finance/overview")
def finance_overview(principal: Principal = Depends(require_finance)):
    """The finance team's landing view: what needs a decision, and what is wrong.

    Deliberately not another spend chart. Analytics already answers "where did
    the money go"; this answers "what is waiting on me, and what is quietly
    broken" -- the two questions that actually change what someone does next.
    """
    def _claims():
        return (
            db().table("claims")
            .select("id,report_name,employee_name,employee_id,status,total_amount,"
                    "created_at,submitted_at")
            .eq("company_id", principal.company_id)
        )

    try:
        claims = fetch_all_rows(_claims)
    except Exception:
        logger.exception("finance overview claims query failed")
        raise HTTPException(
            status_code=503, detail="Could not load the finance overview.")

    pending, flagged = [], []
    totals = {"Draft": 0, "Pending Approval": 0, "Approved": 0,
              "Flagged": 0, "Rejected": 0}
    awaiting_value = 0.0
    for c in claims:
        status = str(c.get("status") or "Draft")
        totals[status] = totals.get(status, 0) + 1
        if status in ("Pending Approval", "Submitted"):
            pending.append(c)
            awaiting_value += float(c.get("total_amount") or 0)
        elif status == "Flagged":
            flagged.append(c)

    def _recent(rows, n=8):
        return sorted(
            rows, key=lambda r: str(r.get("submitted_at") or r.get("created_at") or ""),
            reverse=True)[:n]

    # Expenses nobody can act on until a rate exists -- these are missing from
    # every total on every other screen, which is exactly why they belong on
    # the screen finance opens first.
    unconverted = {"count": 0, "currencies": []}
    try:
        def _unconverted():
            return (
                db().table("expenses").select("currency")
                .eq("company_id", principal.company_id)
                .is_("amount_base", "null")
            )
        rows = fetch_all_rows(_unconverted)
        unconverted = {
            "count": len(rows),
            "currencies": sorted({str(r.get("currency") or "UNKNOWN").upper() for r in rows}),
        }
    except Exception:
        logger.warning("unconverted lookup failed", exc_info=True)

    # Verdicts the model could not support with a real policy citation. In
    # vector mode these were downgraded to Flagged rather than approved, so
    # they are a review queue, not an error count.
    unverified = 0
    try:
        unverified = len(
            db().table("expenses").select("id")
            .eq("company_id", principal.company_id)
            .eq("citation_verified", False)
            .limit(1000).execute().data or [])
    except Exception:
        logger.info("citation_verified column not queryable", exc_info=True)

    policy_version = None
    try:
        rec = (db().table("policies").select("version,file_name,uploaded_at")
               .eq("company_id", principal.company_id).limit(1).execute().data or [])
        policy_version = rec[0] if rec else None
    except Exception:
        logger.info("policy version lookup failed", exc_info=True)

    return {
        "base_currency": config.BASE_CURRENCY,
        "awaiting_decision": len(pending),
        "awaiting_value": round(awaiting_value, 2),
        "flagged_claims": len(flagged),
        "claims_by_status": totals,
        "queue": _recent(pending),
        "flagged": _recent(flagged),
        "unconverted": unconverted,
        "unverified_citations": unverified,
        "policy": policy_version,
        "retrieval_mode": config.POLICY_RETRIEVAL_MODE,
    }
