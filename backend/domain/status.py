from domain.money import parse_amount_value


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
        "pending approval": "Pending Approval",
        "submitted": "Pending Approval",
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
