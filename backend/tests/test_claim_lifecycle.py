"""Lock on the claim approval lifecycle.

The bug this exists for: submitting a claim wrote derive_claim_status(),
which returns "Approved" when every expense cleared the AI audit. A claim
could therefore be approved with no human ever seeing it, while /approvals --
which filters on "Pending Approval" -- stayed permanently empty because
nothing in the codebase ever wrote that value.

An AI verdict is a strong hint about a line item. It is not authority to
release company money.
"""
import pytest

from domain.status import canonical_status, derive_claim_status


# ───────────────── the status vocabulary ─────────────────


def test_pending_approval_is_a_real_status_not_an_alias():
    """It used to map to "Flagged", so the value the approvals queue filters
    on could never appear in the database."""
    assert canonical_status("Pending Approval") == "Pending Approval"
    assert canonical_status("pending approval") == "Pending Approval"


def test_submitted_is_treated_as_awaiting_a_decision():
    assert canonical_status("Submitted") == "Pending Approval"


@pytest.mark.parametrize("raw,expected", [
    ("approved", "Approved"), ("approve", "Approved"), ("ok", "Approved"),
    ("rejected", "Rejected"), ("denied", "Rejected"),
    ("flagged", "Flagged"), ("needs review", "Flagged"),
    ("draft", "Draft"),
])
def test_existing_status_mappings_are_unchanged(raw, expected):
    """The new value must not have disturbed the others."""
    assert canonical_status(raw) == expected


def test_unknown_status_still_defaults_to_flagged():
    """An unrecognised verdict is not an approval."""
    assert canonical_status("banana") == "Flagged"
    assert canonical_status("") == "Flagged"
    assert canonical_status(None) == "Flagged"


# ───────────────── the derived hint ─────────────────


def test_all_approved_expenses_derive_to_approved():
    """derive_claim_status still reports what the audit thought. It is now a
    hint shown to an approver, not the claim's status."""
    items = [{"status": "Approved", "reason": "ok", "amount": 10},
             {"status": "Approved", "reason": "ok", "amount": 20}]
    assert derive_claim_status(items) == "Approved"


def test_one_rejected_expense_dominates():
    items = [{"status": "Approved", "reason": "ok", "amount": 10},
             {"status": "Rejected", "reason": "over limit", "amount": 900}]
    assert derive_claim_status(items) == "Rejected"


def test_one_flagged_expense_dominates_an_otherwise_clean_claim():
    items = [{"status": "Approved", "reason": "ok", "amount": 10},
             {"status": "Flagged", "reason": "needs review", "amount": 90}]
    assert derive_claim_status(items) == "Flagged"


def test_an_empty_claim_is_a_draft():
    assert derive_claim_status([]) == "Draft"


# ───────────────── the rule that matters ─────────────────


def test_submitting_never_writes_the_derived_verdict(monkeypatch):
    """The core protection. Whatever the audit concluded, submitting puts the
    claim in front of a person."""
    import routers.claims as claim_routes
    import deps

    captured = {}

    class _Q:
        def select(self, *a, **k): return self
        def eq(self, *a, **k): return self
        def limit(self, *a, **k): return self
        def update(self, payload):
            captured["update"] = payload
            return self
        def execute(self):
            # The expenses read returns two clean expenses; the claims update
            # returns the row it wrote.
            if "update" in captured:
                return type("R", (), {"data": [{"id": "c1", **captured["update"]}]})()
            return type("R", (), {"data": [
                {"status": "Approved", "reason": "ok", "amount": 10, "amount_base": 10},
                {"status": "Approved", "reason": "ok", "amount": 20, "amount_base": 20},
            ]})()

    monkeypatch.setattr(claim_routes, "db",
                        lambda: type("DB", (), {"table": lambda s, n: _Q()})())
    monkeypatch.setattr(claim_routes, "load_own_claim", lambda cid, p: {"id": cid})

    class _U:
        id = "11111111-1111-1111-1111-111111111111"
    principal = deps.Principal(_U(), {"id": _U.id, "role": "employee", "company_id": "acme"})

    out = claim_routes.submit_claim(claim_id="c1", principal=principal)

    assert captured["update"]["status"] == "Pending Approval"
    # The audit's opinion is still reported, just not acted on.
    assert out["derived_status"] == "Approved"
    assert out["claim"]["status"] == "Pending Approval"


def test_submitting_an_empty_claim_is_refused(monkeypatch):
    """A claim with no expenses has nothing to approve, and used to be
    submitted as a Draft that sat in the queue forever."""
    import routers.claims as claim_routes
    import deps
    from fastapi import HTTPException

    class _Q:
        def select(self, *a, **k): return self
        def eq(self, *a, **k): return self
        def execute(self): return type("R", (), {"data": []})()

    monkeypatch.setattr(claim_routes, "db",
                        lambda: type("DB", (), {"table": lambda s, n: _Q()})())
    monkeypatch.setattr(claim_routes, "load_own_claim", lambda cid, p: {"id": cid})

    class _U:
        id = "11111111-1111-1111-1111-111111111111"
    principal = deps.Principal(_U(), {"id": _U.id, "role": "employee", "company_id": "acme"})

    with pytest.raises(HTTPException) as exc:
        claim_routes.submit_claim(claim_id="c1", principal=principal)
    assert exc.value.status_code == 400
