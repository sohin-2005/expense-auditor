"""Locks on the administrator's organisation overview.

The distinction this protects: an admin dashboard is not the finance one with
different labels. Finance asks "what is waiting on my decision"; an
administrator asks "is this organisation healthy". Money appears here as
volume only, because an admin cannot approve or reject anything -- offering
them a spend figure to act on would be a button with a 403 behind it.
"""
import pytest
from fastapi import HTTPException

import deps
import routers.admin_overview as overview


EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111"
ADMIN_ID = "33333333-3333-3333-3333-333333333333"


class _FakeUser:
    def __init__(self, uid): self.id = uid


def _principal(role="admin", company_id="acme", user_id=ADMIN_ID):
    return deps.Principal(_FakeUser(user_id),
                          {"id": user_id, "role": role, "company_id": company_id})


def _fake_db(profiles, claims, expenses):
    """A db() whose three tables return the given rows."""
    tables = {"profiles": profiles, "claims": claims, "expenses": expenses}

    class _Q:
        def __init__(self, rows): self.rows = rows
        def select(self, *a, **k): return self
        def eq(self, *a, **k): return self
        def order(self, *a, **k): return self
        def range(self, start, end): 
            self.rows = self.rows[start:end + 1]
            return self
        def execute(self): return type("R", (), {"data": self.rows})()

    class _DB:
        def table(self, name): return _Q(list(tables.get(name, [])))

    return lambda: _DB()


def test_only_an_admin_may_read_the_overview():
    """Finance is explicitly refused: it is not a role hierarchy."""
    for role in ("employee", "manager", "finance"):
        with pytest.raises(HTTPException) as exc:
            deps.require_admin(_principal(role=role))
        assert exc.value.status_code == 403


def test_counts_users_by_role(monkeypatch):
    profiles = [
        {"id": "1", "full_name": "A", "role": "admin", "security_question": "q"},
        {"id": "2", "full_name": "B", "role": "finance", "security_question": "q"},
        {"id": "3", "full_name": "C", "role": "employee", "security_question": "q"},
        {"id": "4", "full_name": "D", "role": "employee", "security_question": "q"},
    ]
    monkeypatch.setattr(overview, "db", _fake_db(profiles, [], []))
    out = overview.admin_overview(principal=_principal())

    assert out["people"]["total"] == 4
    assert out["people"]["by_role"]["employee"] == 2
    assert out["people"]["approvers"] == 1        # finance only; admin is not one
    assert out["people"]["administrators"] == 1


def test_admin_is_not_counted_as_an_approver(monkeypatch):
    """The whole role split, expressed as a number on a dashboard. An admin
    reading "1 approver" when that approver is themselves would be actively
    misleading."""
    profiles = [{"id": "1", "full_name": "A", "role": "admin", "security_question": "q"}]
    monkeypatch.setattr(overview, "db", _fake_db(profiles, [], []))
    out = overview.admin_overview(principal=_principal())
    assert out["people"]["approvers"] == 0


def test_people_without_a_security_question_are_surfaced(monkeypatch):
    """An admin fielding "I'm locked out" needs to know before offering help."""
    profiles = [
        {"id": "1", "full_name": "Has one", "role": "employee", "security_question": "q"},
        {"id": "2", "full_name": "Has none", "role": "employee", "security_question": None},
    ]
    monkeypatch.setattr(overview, "db", _fake_db(profiles, [], []))
    out = overview.admin_overview(principal=_principal())

    assert out["people"]["without_recovery_count"] == 1
    assert out["people"]["without_recovery"][0]["full_name"] == "Has none"


def test_stalled_claims_are_separated_from_merely_pending(monkeypatch):
    """A claim submitted this morning is normal. One submitted three weeks ago
    means nobody is approving, which is a people problem and therefore an
    admin's to chase."""
    profiles = [{"id": "1", "full_name": "A", "role": "employee", "security_question": "q"}]
    claims = [
        {"id": "recent", "employee_id": "1", "status": "Pending Approval",
         "total_amount": 10, "submitted_at": "2099-01-01T00:00:00", "created_at": "2099-01-01T00:00:00"},
        {"id": "stale", "employee_id": "1", "status": "Pending Approval",
         "total_amount": 20, "submitted_at": "2020-01-01T00:00:00", "created_at": "2020-01-01T00:00:00"},
    ]
    monkeypatch.setattr(overview, "db", _fake_db(profiles, claims, []))
    out = overview.admin_overview(principal=_principal())

    assert out["claims"]["awaiting_decision"] == 2
    assert out["claims"]["stalled"] == 1


def test_approved_but_unpaid_is_tracked(monkeypatch):
    """Approved is not paid, and the gap is where "where is my money" lives."""
    profiles = [{"id": "1", "full_name": "A", "role": "employee", "security_question": "q"}]
    claims = [
        {"id": "p", "employee_id": "1", "status": "Approved", "total_amount": 100,
         "reimbursement_status": "Paid", "created_at": "2026-01-01T00:00:00"},
        {"id": "u", "employee_id": "1", "status": "Approved", "total_amount": 250,
         "reimbursement_status": "Not started", "created_at": "2026-01-01T00:00:00"},
    ]
    monkeypatch.setattr(overview, "db", _fake_db(profiles, claims, []))
    out = overview.admin_overview(principal=_principal())

    assert out["claims"]["approved_unpaid"] == 1
    assert out["claims"]["approved_unpaid_value"] == 250.0


def test_unconverted_expenses_are_excluded_from_volume_and_reported(monkeypatch):
    """The same rule as everywhere else: an expense with no rate is left out
    and named, never folded in at an implied 1:1."""
    profiles = [{"id": "1", "full_name": "A", "role": "employee", "security_question": "q"}]
    expenses = [
        {"id": "a", "employee_id": "1", "status": "Approved", "amount": 100,
         "amount_base": 100, "currency": "USD", "created_at": "2026-01-01T00:00:00"},
        {"id": "b", "employee_id": "1", "status": "Approved", "amount": 5000,
         "amount_base": None, "currency": "INR", "created_at": "2026-01-01T00:00:00"},
    ]
    monkeypatch.setattr(overview, "db", _fake_db(profiles, [], expenses))
    out = overview.admin_overview(principal=_principal())

    assert out["expenses"]["volume"] == 100.0          # not 5100
    assert out["expenses"]["unconverted"] == 1
    assert out["expenses"]["unconverted_currencies"] == ["INR"]


def test_empty_organisation_does_not_divide_by_zero(monkeypatch):
    monkeypatch.setattr(overview, "db", _fake_db([], [], []))
    out = overview.admin_overview(principal=_principal())
    assert out["people"]["total"] == 0
    assert out["claims"]["total"] == 0
    assert out["expenses"]["volume"] == 0
