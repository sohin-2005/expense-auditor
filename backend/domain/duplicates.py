from db import db


def find_potential_duplicate(employee_id: str, vendor: str, amount, tx_date: str):
    """Detect a likely duplicate: same user, same amount (±0.01), same vendor or same date."""
    try:
        amt = float(amount or 0)
        if amt <= 0:
            return None
        rows = (
            db().table("expenses")
            .select("id,vendor_name,merchant_name,amount,transaction_date,date,created_at")
            .eq("employee_id", str(employee_id))
            .order("created_at", desc=True)
            .limit(120)
            .execute().data or []
        )
        v = str(vendor or "").strip().lower()
        d = str(tx_date or "").strip()[:10]
        for r in rows:
            r_amt = float(r.get("amount") or 0)
            if abs(r_amt - amt) > 0.01:
                continue
            r_vendor = str(r.get("vendor_name") or r.get(
                "merchant_name") or "").strip().lower()
            r_date = str(r.get("transaction_date")
                         or r.get("date") or "").strip()[:10]
            vendor_match = bool(v and r_vendor and v == r_vendor)
            date_match = bool(d and r_date and d == r_date)
            if vendor_match and (date_match or not d):
                return r
            if vendor_match and date_match:
                return r
        return None
    except Exception:
        return None


def apply_duplicate_check(expense: dict):
    """If a likely duplicate exists, flag the expense and annotate the reason."""
    dup = find_potential_duplicate(
        expense.get("employee_id"),
        expense.get("vendor_name") or expense.get("merchant_name"),
        expense.get("amount"),
        expense.get("transaction_date") or expense.get("date"),
    )
    if dup:
        expense["status"] = "Flagged"
        expense["risk_level"] = "High"
        expense["reason"] = (
            "Possible duplicate: an expense with the same vendor and amount already exists. "
            + str(expense.get("reason") or "")
        ).strip()
        expense["duplicate_of"] = dup.get("id")
    return expense
