import logging
import re
from datetime import datetime
from fastapi import HTTPException
from config import BASE_CURRENCY, _fx_cache
from db import db

logger = logging.getLogger(__name__)


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
    except (TypeError, ValueError):
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


def lookup_fx_rate(currency: str, on_date: str | None):
    """Rate converting `currency` into BASE_CURRENCY on a given date.

    Returns (rate, rate_date) or (None, None) when no rate is on file. None
    is a real answer here, not a failure to be papered over: an expense in a
    currency nobody has given a rate for must be excluded from base-currency
    totals and reported, never folded in at an implied 1:1.
    """
    code = str(currency or "").strip().upper()
    if not code:
        return None, None

    eff_date = None
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", str(on_date or ""))
    if m:
        eff_date = m.group(1)
    if not eff_date:
        eff_date = datetime.utcnow().date().isoformat()

    if code == BASE_CURRENCY:
        return 1.0, eff_date

    cache_key = (code, eff_date)
    cached = _fx_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        res = (
            db().table("fx_rates")
            .select("rate_to_base,rate_date")
            .eq("base_currency", BASE_CURRENCY)
            .eq("currency", code)
            .lte("rate_date", eff_date)
            .order("rate_date", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
    except HTTPException:
        raise
    except Exception:
        logger.exception("fx rate lookup failed for %s on %s", code, eff_date)
        return None, None

    if not rows:
        logger.warning(
            "no %s->%s rate on or before %s; expense will be excluded from "
            "base-currency totals until one is added to fx_rates",
            code, BASE_CURRENCY, eff_date,
        )
        result = (None, None)
    else:
        result = (float(rows[0]["rate_to_base"]), rows[0].get("rate_date"))

    _fx_cache.set(cache_key, result)
    return result


def apply_fx(expense: dict) -> dict:
    """Attach base-currency fields to an expense before it is inserted.

    The rate is locked in at write time rather than looked up on read, so a
    later rate correction cannot silently restate a reimbursement that has
    already been decided.
    """
    rate, rate_date = lookup_fx_rate(
        expense.get("currency"),
        expense.get("transaction_date") or expense.get("date"),
    )
    expense["base_currency"] = BASE_CURRENCY
    expense["fx_rate"] = rate
    expense["fx_date"] = rate_date
    amount = expense.get("amount")
    expense["amount_base"] = (
        round(float(amount) * rate, 2)
        if rate is not None and amount is not None else None
    )
    return expense


def claim_total_base(items: list) -> float:
    """Sum a claim's expenses in the base currency.

    This used to add `amount` across currencies, so a claim mixing a Rs.5,000
    taxi with a $5,000 flight reported 10,000 of nothing in particular.
    Unconverted rows (no rate on file) contribute 0 rather than their raw
    figure -- adding them at an implied 1:1 is the bug being fixed. The
    shortfall is visible through analytics' `unconverted` block.
    """
    return round(sum(float(e.get("amount_base") or 0) for e in items), 2)


CLAIM_SYNC_COLUMNS = "amount,amount_base,status,reason"
