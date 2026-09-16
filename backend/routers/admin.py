import logging
from datetime import datetime

from fastapi import APIRouter, Body, Depends, HTTPException

import ai_provider
import config
from db import db, fetch_all_rows
from deps import (ADMIN_ROLE, ALL_ROLES, Principal, invalidate_profile,
                  load_profile, require_admin, require_policy_editor)

logger = logging.getLogger(__name__)

router = APIRouter()


# ───────────────── PEOPLE ─────────────────


@router.get("/admin/users")
def list_users(principal: Principal = Depends(require_admin)):
    """Everyone in the caller's company, with their role and activity.

    Scoped to company_id like every other company-wide read: an admin
    administers their own organisation, not the database.
    """
    def _page():
        return (
            db().table("profiles")
            .select("id,full_name,role,company_id")
            .eq("company_id", principal.company_id)
            .order("full_name")
        )

    try:
        users = fetch_all_rows(_page)
    except Exception:
        logger.exception("user list failed for company %s", principal.company_id)
        raise HTTPException(
            status_code=503, detail="Could not load users. Please try again shortly.")

    # One aggregate query rather than a per-user round trip: this list is the
    # admin dashboard's landing view and used to be the obvious place to
    # accidentally write an N+1.
    counts = {}
    try:
        def _expenses():
            return (
                db().table("expenses")
                .select("employee_id,status,amount_base")
                .eq("company_id", principal.company_id)
            )
        for row in fetch_all_rows(_expenses):
            eid = str(row.get("employee_id") or "")
            slot = counts.setdefault(eid, {"expenses": 0, "flagged": 0, "spend": 0.0})
            slot["expenses"] += 1
            if row.get("status") in ("Flagged", "Rejected"):
                slot["flagged"] += 1
            slot["spend"] += float(row.get("amount_base") or 0)
    except Exception:
        # Activity is decoration on this screen; the roster is the point.
        logger.warning("could not load per-user activity", exc_info=True)

    out = []
    for u in users:
        stat = counts.get(str(u.get("id")), {})
        out.append({
            "id": u.get("id"),
            "full_name": u.get("full_name"),
            "role": str(u.get("role") or "employee").strip().lower(),
            "expenses": stat.get("expenses", 0),
            "flagged": stat.get("flagged", 0),
            "spend": round(stat.get("spend", 0.0), 2),
            "is_self": str(u.get("id")) == principal.id,
        })

    by_role = {}
    for u in out:
        by_role[u["role"]] = by_role.get(u["role"], 0) + 1

    return {
        "users": out,
        "total": len(out),
        "by_role": by_role,
        "base_currency": config.BASE_CURRENCY,
        "assignable_roles": list(ALL_ROLES),
    }


@router.post("/admin/users/{user_id}/role")
def set_user_role(
    user_id: str,
    role: str = Body(..., embed=True),
    principal: Principal = Depends(require_admin),
):
    """Grant or revoke a role.

    Admin-only, and deliberately not available to finance: whoever can grant
    approval rights should not also be able to use them. Before
    profiles_authorization.sql this needed no authority at all -- signup
    wrote `role` straight from the browser, so anyone could pick "Finance
    Team" from a dropdown.
    """
    normalized = str(role or "").strip().lower()
    if normalized not in ALL_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Role must be one of: {', '.join(ALL_ROLES)}.",
        )

    # load_profile's 403 is phrased for the caller ("your account"); here the
    # subject is somebody else, so a missing target is simply not found.
    try:
        target = load_profile(user_id)
    except HTTPException as e:
        if e.status_code == 403:
            raise HTTPException(status_code=404, detail="User not found")
        raise

    if str(target.get("company_id") or "default") != principal.company_id:
        raise HTTPException(status_code=404, detail="User not found")

    # Removing your own privileges can leave a company with no admin at all,
    # and the recovery path is the SQL editor. Refuse it here.
    if user_id == principal.id and normalized != principal.role:
        raise HTTPException(
            status_code=400,
            detail="You cannot change your own role. Ask another administrator.",
        )

    # Demoting the last admin is the same trap one step removed.
    if str(target.get("role") or "").strip().lower() == ADMIN_ROLE and normalized != ADMIN_ROLE:
        try:
            remaining = (
                db().table("profiles").select("id")
                .eq("company_id", principal.company_id)
                .eq("role", ADMIN_ROLE)
                .execute().data or []
            )
        except Exception:
            remaining = []
        if len(remaining) <= 1:
            raise HTTPException(
                status_code=400,
                detail="This is the only administrator. Promote someone else first.",
            )

    res = (
        db().table("profiles")
        .update({"role": normalized})
        .eq("id", user_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")

    invalidate_profile(user_id)
    logger.info("role change target=%s new_role=%s by=%s",
                user_id, normalized, principal.id)
    return {"success": True, "user_id": user_id, "role": normalized}


# ───────────────── CONFIGURATION ─────────────────


@router.get("/admin/system")
def system_status(principal: Principal = Depends(require_admin)):
    """What state this deployment is actually in.

    The same facts /health reports, plus the ones an operator needs and a
    load balancer does not: which retrieval mode is live, whether policy
    chunks were ever ingested, and whether exchange rates exist. Each of
    these fails silently when unset -- retrieval falls back to keyword
    matching, unconverted expenses drop out of totals -- so the point of this
    screen is to make "configured but doing nothing" visible.
    """
    checks = []

    checks.append({
        "name": "Database",
        "ok": db is not None and not any("Supabase" in e for e in config.BOOT_ERRORS),
        "detail": "Connected" if not config.BOOT_ERRORS else "; ".join(config.BOOT_ERRORS),
    })

    providers = ai_provider.describe_providers()
    checks.append({
        "name": "AI providers",
        "ok": bool(providers),
        "detail": ", ".join(f"{p['name']}/{p['model']} ({p['task']})" for p in providers)
                  or "none configured",
    })

    chunk_count = embedded = None
    try:
        rows = (
            db().table("policy_chunks")
            .select("id,embedding")
            .eq("company_id", principal.company_id)
            .limit(2000)
            .execute().data or []
        )
        chunk_count = len(rows)
        embedded = sum(1 for r in rows if r.get("embedding") is not None)
    except Exception:
        logger.info("policy_chunks not readable", exc_info=True)

    checks.append({
        "name": "Policy retrieval",
        "ok": config.POLICY_RETRIEVAL_MODE == "vector" and bool(chunk_count),
        "detail": (
            f"mode={config.POLICY_RETRIEVAL_MODE}; "
            + (f"{chunk_count} chunks, {embedded} embedded"
               if chunk_count is not None else "policy_chunks unavailable — run 005_policy_chunks.sql")
        ),
    })

    rate_count = None
    try:
        rate_count = len(
            db().table("fx_rates").select("currency")
            .eq("base_currency", config.BASE_CURRENCY)
            .limit(500).execute().data or [])
    except Exception:
        logger.info("fx_rates not readable", exc_info=True)

    checks.append({
        "name": "Exchange rates",
        "ok": bool(rate_count),
        "detail": (f"{rate_count} rates against {config.BASE_CURRENCY}"
                   if rate_count is not None
                   else "fx_rates unavailable — run 003_fx.sql"),
    })

    return {
        "status": "ok" if not config.BOOT_ERRORS else "degraded",
        "boot_errors": config.BOOT_ERRORS,
        "model_warnings": config.MODEL_WARNINGS,
        "base_currency": config.BASE_CURRENCY,
        "policy_retrieval_mode": config.POLICY_RETRIEVAL_MODE,
        "checks": checks,
        "time": datetime.utcnow().isoformat(),
    }


# ───────────────── EXCHANGE RATES ─────────────────


@router.get("/admin/fx-rates")
def list_fx_rates(principal: Principal = Depends(require_policy_editor)):
    """Current rates, plus the currencies that need one.

    The second half matters more than the first: an expense in a currency
    with no rate is excluded from every total and reported as unconverted,
    which is easy to miss until someone asks why the numbers look low.
    """
    try:
        rates = (
            db().table("fx_rates")
            .select("currency,rate_to_base,rate_date,source")
            .eq("base_currency", config.BASE_CURRENCY)
            .order("rate_date", desc=True)
            .limit(500).execute().data or []
        )
    except Exception:
        logger.exception("fx rate list failed")
        raise HTTPException(
            status_code=503,
            detail="Could not load exchange rates. Has db/003_fx.sql been applied?")

    latest = {}
    for r in rates:
        code = str(r.get("currency") or "").upper()
        if code not in latest:
            latest[code] = r

    missing = {}
    try:
        def _unconverted():
            return (
                db().table("expenses").select("currency,amount")
                .eq("company_id", principal.company_id)
                .is_("amount_base", "null")
            )
        for row in fetch_all_rows(_unconverted):
            code = str(row.get("currency") or "UNKNOWN").upper()
            slot = missing.setdefault(code, {"currency": code, "count": 0, "amount": 0.0})
            slot["count"] += 1
            slot["amount"] += float(row.get("amount") or 0)
    except Exception:
        logger.warning("could not compute unconverted currencies", exc_info=True)

    return {
        "base_currency": config.BASE_CURRENCY,
        "rates": sorted(latest.values(), key=lambda r: r.get("currency") or ""),
        "missing": sorted(missing.values(), key=lambda m: -m["count"]),
    }


@router.post("/admin/fx-rates")
def upsert_fx_rate(
    currency: str = Body(..., embed=True),
    rate_to_base: float = Body(..., embed=True),
    rate_date: str = Body("", embed=True),
    principal: Principal = Depends(require_policy_editor),
):
    """Add or correct one exchange rate.

    Dated, and looked up as "the most recent rate on or before the
    transaction date", so adding a rate today does not restate expenses that
    already converted at an older one.
    """
    code = str(currency or "").strip().upper()
    if not code or len(code) > 8:
        raise HTTPException(status_code=400, detail="Currency code is required.")
    if code == config.BASE_CURRENCY:
        raise HTTPException(
            status_code=400,
            detail=f"{code} is the base currency and always converts at 1.0.")
    try:
        rate = float(rate_to_base)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Rate must be a number.")
    if rate <= 0:
        raise HTTPException(status_code=400, detail="Rate must be greater than zero.")

    when = (rate_date or "").strip() or datetime.utcnow().date().isoformat()

    try:
        db().table("fx_rates").upsert({
            "base_currency": config.BASE_CURRENCY,
            "currency": code,
            "rate_date": when,
            "rate_to_base": rate,
            "source": f"manual:{principal.id}",
        }).execute()
    except Exception:
        logger.exception("fx rate upsert failed for %s", code)
        raise HTTPException(
            status_code=503, detail="Could not save that rate. Please try again shortly.")

    # Rates are cached for 15 minutes; without this the new rate would not
    # apply to the next expense saved.
    config._fx_cache._data.clear()

    logger.info("fx rate set %s->%s %s on %s by %s",
                code, config.BASE_CURRENCY, rate, when, principal.id)
    return {"success": True, "currency": code, "rate_to_base": rate, "rate_date": when}
