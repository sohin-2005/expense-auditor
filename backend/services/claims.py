import logging
from db import db, fetch_all_rows
from domain.money import CLAIM_SYNC_COLUMNS, claim_total_base
from domain.status import canonical_status, derive_claim_status, resolve_expense_status

logger = logging.getLogger(__name__)


def sync_claim_status_totals(claim_id: str):
    if not claim_id:
        return None

    exp_res = db().table("expenses").select(
        CLAIM_SYNC_COLUMNS).eq("claim_id", claim_id).execute()
    items = exp_res.data or []
    total = claim_total_base(items)

    # Only a Draft claim has its status derived from its expenses. Once it has
    # been submitted, its status belongs to the approval workflow -- attaching
    # an expense to a claim awaiting a decision must not quietly approve it,
    # and must not drag an already-approved claim back into review either.
    try:
        current = (db().table("claims").select("status")
                   .eq("id", claim_id).limit(1).execute().data or [])
    except Exception:
        current = []
    status_now = str(current[0].get("status") if current else "Draft")

    update = {"total_amount": total}
    if status_now in ("Draft", ""):
        update["status"] = derive_claim_status(items)

    updated = db().table("claims").update(update).eq("id", claim_id).execute()
    claim_status = update.get("status", status_now)

    return updated.data[0] if updated.data else {"id": claim_id, "status": claim_status, "total_amount": total}


def enrich_claims_with_ai_summary(claims: list):
    if not claims:
        return claims

    claim_ids = [c.get("id") for c in claims if c.get("id")]
    if not claim_ids:
        return claims

    def _page():
        return (
            db().table("expenses")
            .select("claim_id,status,reason,policy_snippet,amount,amount_base,"
                    "currency,expense_type,vendor_name")
            .in_("claim_id", claim_ids)
            .order("claim_id")
        )

    try:
        # Paged: a page of claims can easily carry more than 1000 expenses
        # between them, and the missing ones would just vanish from the
        # summaries without any error.
        rows = fetch_all_rows(_page)
    except Exception:
        logger.exception("claim enrichment query failed")
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
