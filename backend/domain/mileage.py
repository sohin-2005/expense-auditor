"""Mileage reimbursement.

Deliberately arithmetic, not a model call. A mileage claim has no receipt to
read and no judgement to make -- distance times the company rate is the
answer. Computing it in code is cheaper and instant, and it cannot be argued
out of by text on a document the way an LLM verdict can.
"""
import logging

from db import db

logger = logging.getLogger(__name__)

VALID_UNITS = ("km", "mi")
MAX_REASONABLE_DISTANCE = 5000  # a single journey, in the claimed unit


def get_mileage_rate(company_id: str, unit: str = "km"):
    """The company's rate for a unit, or None if none is on file.

    None is a real answer: without a rate there is no defensible amount, so
    the claim is refused rather than reimbursed at a number nobody set.
    """
    unit = (unit or "km").strip().lower()
    if unit not in VALID_UNITS:
        return None
    try:
        rows = (
            db().table("mileage_rates")
            .select("rate,currency,unit,effective_from")
            .eq("company_id", company_id)
            .eq("unit", unit)
            .order("effective_from", desc=True)
            .limit(1)
            .execute().data or []
        )
    except Exception:
        logger.exception("mileage rate lookup failed for %s/%s", company_id, unit)
        return None
    return rows[0] if rows else None


def compute_mileage(distance, unit, rate_row) -> dict:
    """Distance x rate, with the inputs kept for the audit trail."""
    amount = round(float(distance) * float(rate_row["rate"]), 2)
    return {
        "amount": amount,
        "currency": rate_row.get("currency"),
        "distance": float(distance),
        "distance_unit": unit,
        "mileage_rate": float(rate_row["rate"]),
    }
