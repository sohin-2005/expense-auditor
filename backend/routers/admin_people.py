"""Per-person administration: what someone has done, and removing them.

Split from admin.py rather than appended to it. That file already covers the
roster, roles, system status and exchange rates; this is the drill-down, and
keeping the two apart is what stops admin.py becoming the next main.py.
"""
import logging

from fastapi import APIRouter, Body, Depends, HTTPException

import config
from db import db, fetch_all_rows, require_supabase
from deps import invalidate_profile, Principal, load_profile, require_admin

logger = logging.getLogger(__name__)

router = APIRouter()

APPROVER_ROLES = ("manager", "finance")


def _same_company_profile(user_id: str, principal: Principal) -> dict:
    """A profile in the caller's company, or 404.

    404 rather than 403 on a cross-company id, for the same reason claims use
    it: confirming that an id exists elsewhere is itself a small leak.
    """
    try:
        target = load_profile(user_id)
    except HTTPException as e:
        # load_profile's 403 is phrased for the caller ("your account"); here
        # the subject is somebody else, so a missing target is not found.
        if e.status_code == 403:
            raise HTTPException(status_code=404, detail="User not found")
        raise
    if str(target.get("company_id") or "default") != principal.company_id:
        raise HTTPException(status_code=404, detail="User not found")
    return target


def _email_of(user_id: str):
    """Look up one email.

    get_user_by_id, not list_users(): the old form fetched EVERY auth user in
    the project and linear-scanned it, which cost ~1s on this deployment and
    grows with the user table rather than with the request.
    """
    try:
        result = require_supabase().auth.admin.get_user_by_id(str(user_id))
        return str(getattr(result.user, "email", "") or "") or None
    except Exception:
        logger.warning("could not read email for %s", user_id, exc_info=True)
    return None


@router.get("/admin/users/{user_id}")
def user_detail(user_id: str, principal: Principal = Depends(require_admin)):
    """Everything this organisation knows about one person.

    An administrator arrives with "what has this person actually been doing",
    not "how much did they spend" -- so this leads with activity: claims
    filed, what was approved, what keeps tripping policy, when they were last
    seen.

    It deliberately does not return receipt images or the policy text behind a
    verdict. Reading somebody's evidence is the approver's job, and an admin
    is explicitly not an approver.
    """
    _same_company_profile(user_id, principal)

    try:
        full = (db().table("profiles").select("*")
                .eq("id", user_id).limit(1).execute().data or [{}])[0]
    except Exception:
        logger.exception("profile read failed for %s", user_id)
        raise HTTPException(status_code=503, detail="Could not load that person.")

    def _expenses():
        return (db().table("expenses")
                .select("id,status,amount,amount_base,currency,expense_type,"
                        "vendor_name,transaction_date,created_at,claim_id,"
                        "receipt_missing,citation_verified")
                .eq("employee_id", user_id))

    def _claims():
        return (db().table("claims")
                .select("id,report_name,status,total_amount,created_at,"
                        "submitted_at,reimbursement_status")
                .eq("employee_id", user_id))

    try:
        expenses = fetch_all_rows(_expenses)
        claims = fetch_all_rows(_claims)
    except Exception:
        logger.exception("activity lookup failed for %s", user_id)
        raise HTTPException(
            status_code=503, detail="Could not load that person's activity.")

    def _tally(rows, key="status"):
        out = {}
        for r in rows:
            label = str(r.get(key) or "Unknown")
            out[label] = out.get(label, 0) + 1
        return out

    def _when(row):
        return str(row.get("submitted_at") or row.get("created_at") or "")

    approved = [c for c in claims if c.get("status") == "Approved"]
    last_active = max(
        [_when(c) for c in claims]
        + [str(e.get("created_at") or "") for e in expenses]
        + [""])

    return {
        "user": {
            "id": user_id,
            "full_name": full.get("full_name"),
            "email": _email_of(user_id),
            "role": str(full.get("role") or "employee").strip().lower(),
            "company_id": full.get("company_id"),
            "company_name": full.get("company_name"),
            "phone": full.get("phone"),
            "job_title": full.get("job_title"),
            # Whether they can recover their own account. An admin fielding
            # "I'm locked out" needs to know before offering to help.
            "has_security_question": bool(full.get("security_question")),
            "updated_at": full.get("updated_at"),
            "is_self": str(user_id) == principal.id,
        },
        "activity": {
            "last_active": last_active or None,
            "expenses": len(expenses),
            "claims": len(claims),
            "approved_claims": len(approved),
            "approved_value": round(
                sum(float(c.get("total_amount") or 0) for c in approved), 2),
            "spend": round(sum(float(e.get("amount_base") or 0) for e in expenses), 2),
            "unconverted_expenses": sum(1 for e in expenses if e.get("amount_base") is None),
            "unfiled_expenses": sum(1 for e in expenses if not e.get("claim_id")),
            "missing_receipts": sum(1 for e in expenses if e.get("receipt_missing")),
            "claims_by_status": _tally(claims),
            "expenses_by_status": _tally(expenses),
            "reimbursement": _tally(claims, "reimbursement_status"),
        },
        "recent_claims": sorted(claims, key=_when, reverse=True)[:10],
        "recent_expenses": sorted(
            expenses, key=lambda e: str(e.get("created_at") or ""), reverse=True)[:10],
        "base_currency": config.BASE_CURRENCY,
    }


@router.delete("/admin/users/{user_id}")
def remove_user(
    user_id: str,
    transfer_to: str = Body("", embed=True),
    principal: Principal = Depends(require_admin),
):
    """Remove someone from the organisation.

    Their expenses and claims are NOT deleted. Financial records outlive the
    employment that produced them: an approved claim is evidence of a payment,
    and destroying it because somebody left is how an audit trail develops
    holes exactly where an auditor will look. The rows are either reassigned
    to another person (`transfer_to`) or left in place with the profile
    removed.

    Either way the account loses access immediately, because load_profile()
    refuses a caller with no profile row.
    """
    if user_id == principal.id:
        raise HTTPException(
            status_code=400,
            detail="You cannot remove your own account. Ask another administrator.")

    target = _same_company_profile(user_id, principal)
    target_role = str(target.get("role") or "employee").strip().lower()

    # Losing the last approver silently is how a company finds out weeks later
    # that nothing has been approved since.
    if target_role in APPROVER_ROLES:
        try:
            others = (db().table("profiles").select("id")
                      .eq("company_id", principal.company_id)
                      .in_("role", list(APPROVER_ROLES)).execute().data or [])
        except Exception:
            logger.exception("approver count failed")
            others = []
        if not [o for o in others if str(o["id"]) != user_id]:
            raise HTTPException(
                status_code=400,
                detail="This is the only person who can approve claims. "
                       "Give the role to someone else first.")

    moved = 0
    if transfer_to:
        _same_company_profile(transfer_to, principal)
        if transfer_to == user_id:
            raise HTTPException(
                status_code=400, detail="Cannot transfer records to the same person.")
        for table in ("expenses", "claims", "travel_plans"):
            try:
                res = (db().table(table).update({"employee_id": transfer_to})
                       .eq("employee_id", user_id).execute())
                moved += len(res.data or [])
            except Exception:
                logger.exception("could not transfer %s from %s", table, user_id)

    try:
        db().table("profiles").delete().eq("id", user_id).execute()
    except Exception:
        logger.exception("profile delete failed for %s", user_id)
        raise HTTPException(status_code=503, detail="Could not remove that person.")

    # The auth row lives in a different system and needs a permission the
    # service role does not always hold. Its failure must not undo the
    # removal -- with no profile row the account cannot reach anything.
    auth_removed = True
    try:
        require_supabase().auth.admin.delete_user(user_id)
    except Exception as e:
        auth_removed = False
        logger.warning("auth user %s not deleted: %s", user_id, str(e)[:120])

    invalidate_profile(user_id)
    logger.info("user removed %s by=%s transferred=%d auth_removed=%s",
                user_id, principal.id, moved, auth_removed)

    detail = "Access revoked and profile removed."
    detail += (f" {moved} record(s) reassigned." if moved
               else " Their expenses and claims were kept.")
    if not auth_removed:
        detail += (" The sign-in record could not be deleted automatically — "
                   "remove it in the Supabase dashboard if you need it gone.")

    return {
        "success": True,
        "records_transferred": moved,
        "auth_account_removed": auth_removed,
        "detail": detail,
    }
