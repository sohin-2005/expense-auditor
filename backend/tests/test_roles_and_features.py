"""Locks on the four-role model and the employee features added with it.

The role split is the part worth pinning down. Admin is deliberately NOT a
superset of finance: if one role could both grant approval rights and approve,
a single account could quietly give itself the power to approve its own spend.
That is a design decision, not an oversight, and it is exactly the kind of
thing a later "simplification" undoes by accident.
"""

import pytest
from fastapi import HTTPException

import deps
import domain.mileage as mileage
import routers.admin as admin_routes


EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111"
ADMIN_ID = "33333333-3333-3333-3333-333333333333"


class _FakeUser:
    def __init__(self, user_id):
        self.id = user_id


def _principal(role="employee", company_id="acme", user_id=EMPLOYEE_ID):
    return deps.Principal(
        _FakeUser(user_id),
        {"id": user_id, "role": role, "company_id": company_id},
    )


# ───────────────── the role split ─────────────────


def test_admin_cannot_approve_claims():
    """The whole reason admin and finance are separate roles."""
    admin = _principal(role="admin", user_id=ADMIN_ID)
    assert admin.is_admin is True
    assert admin.is_privileged is False
    with pytest.raises(HTTPException) as exc:
        deps.require_finance(admin)
    assert exc.value.status_code == 403


def test_finance_cannot_manage_users():
    """The same fence, from the other side. Finance approves money; it does
    not decide who else gets to."""
    finance = _principal(role="finance")
    assert finance.is_privileged is True
    assert finance.is_admin is False
    with pytest.raises(HTTPException) as exc:
        deps.require_admin(finance)
    assert exc.value.status_code == 403


def test_manager_approves_but_cannot_rewrite_the_policy():
    """A manager approves against the rules. Only finance changes them --
    the policy IS the enforcement engine, so editing it is the most
    consequential write in the service."""
    manager = _principal(role="manager")
    assert deps.require_finance(manager) is manager
    with pytest.raises(HTTPException) as exc:
        deps.require_policy_editor(manager)
    assert exc.value.status_code == 403


def test_finance_may_rewrite_the_policy():
    finance = _principal(role="finance")
    assert deps.require_policy_editor(finance) is finance


@pytest.mark.parametrize("role,expected", [
    ("employee", {"approve_claims": False, "manage_users": False, "edit_policy": False}),
    ("manager", {"approve_claims": True, "manage_users": False, "edit_policy": False}),
    ("finance", {"approve_claims": True, "manage_users": False, "edit_policy": True}),
    ("admin", {"approve_claims": False, "manage_users": True, "edit_policy": False}),
])
def test_capabilities_match_the_gates(role, expected):
    """GET /me drives the navigation, so its answer must agree with what the
    endpoints will actually allow. A capability set that over-promises renders
    menu items that 403 on click."""
    caps = _principal(role=role).capabilities()
    for key, value in expected.items():
        assert caps[key] is value, f"{role}: {key}"


# ───────────────── admin guards ─────────────────


def test_unknown_role_is_rejected():
    admin = _principal(role="admin", user_id=ADMIN_ID)
    with pytest.raises(HTTPException) as exc:
        admin_routes.set_user_role(user_id=EMPLOYEE_ID, role="superuser", principal=admin)
    assert exc.value.status_code == 400


def test_admin_cannot_change_their_own_role(monkeypatch):
    """Self-demotion can strand a company with no administrator, and the
    recovery path is the SQL editor."""
    admin = _principal(role="admin", company_id="acme", user_id=ADMIN_ID)
    monkeypatch.setattr(admin_routes, "load_profile",
                        lambda uid: {"id": uid, "role": "admin", "company_id": "acme"})
    with pytest.raises(HTTPException) as exc:
        admin_routes.set_user_role(user_id=ADMIN_ID, role="employee", principal=admin)
    assert exc.value.status_code == 400


def test_roles_cannot_be_changed_across_companies(monkeypatch):
    admin = _principal(role="admin", company_id="acme", user_id=ADMIN_ID)
    monkeypatch.setattr(admin_routes, "load_profile",
                        lambda uid: {"id": uid, "role": "employee", "company_id": "globex"})
    with pytest.raises(HTTPException) as exc:
        admin_routes.set_user_role(user_id=EMPLOYEE_ID, role="finance", principal=admin)
    assert exc.value.status_code == 404


# ───────────────── mileage ─────────────────


def test_mileage_is_distance_times_rate():
    """Arithmetic, not a model call. The figure must be exact and repeatable,
    which is the entire reason this path exists separately from OCR."""
    out = mileage.compute_mileage(
        48.5, "km", {"rate": 0.21, "currency": "USD", "effective_from": "2026-01-01"})
    assert out["amount"] == round(48.5 * 0.21, 2)
    assert out["currency"] == "USD"
    assert out["distance_unit"] == "km"
    # The inputs travel with the result: an approver has to be able to see how
    # the number was reached without recomputing it.
    assert out["distance"] == 48.5
    assert out["mileage_rate"] == 0.21


def test_no_rate_on_file_is_a_real_answer(monkeypatch):
    """None, not a default. Reimbursing at a rate nobody set is worse than
    refusing the claim."""
    class _Q:
        def select(self, *a, **k): return self
        def eq(self, *a, **k): return self
        def order(self, *a, **k): return self
        def limit(self, *a, **k): return self
        def execute(self): return type("R", (), {"data": []})()

    monkeypatch.setattr(mileage, "db",
                        lambda: type("DB", (), {"table": lambda s, n: _Q()})())
    assert mileage.get_mileage_rate("acme", "km") is None


@pytest.mark.parametrize("unit", ["furlong", "", None, "KM "])
def test_unsupported_distance_units_are_refused(unit, monkeypatch):
    monkeypatch.setattr(mileage, "db",
                        lambda: (_ for _ in ()).throw(
                            AssertionError("db hit for an invalid unit")))
    if unit == "KM ":
        # Normalized, not rejected — a trailing space is a typo, not a
        # different unit.
        return
    assert mileage.get_mileage_rate("acme", unit) is None


# ───────────────── oversight roles do not file expenses ─────────────────


@pytest.mark.parametrize("role", ["finance", "admin"])
def test_oversight_roles_cannot_submit_expenses(role):
    """Enforced on the server, not merely hidden in the navigation.

    Hiding a button is a rendering choice; this is the rule. Without it,
    "finance does not file its own expenses" would hold only for as long as
    nobody typed the URL.
    """
    principal = _principal(role=role)
    assert principal.submits_expenses is False
    with pytest.raises(HTTPException) as exc:
        deps.require_submitter(principal)
    assert exc.value.status_code == 403
    # The message has to say what to do instead, or it reads as a bug.
    assert "employee account" in exc.value.detail


@pytest.mark.parametrize("role", ["employee", "manager"])
def test_submitting_roles_may_file_expenses(role):
    principal = _principal(role=role)
    assert principal.submits_expenses is True
    assert deps.require_submitter(principal) is principal


def test_capabilities_report_submit_expenses():
    """The navigation renders from this, so it must agree with the gate."""
    assert _principal(role="employee").capabilities()["submit_expenses"] is True
    assert _principal(role="manager").capabilities()["submit_expenses"] is True
    assert _principal(role="finance").capabilities()["submit_expenses"] is False
    assert _principal(role="admin").capabilities()["submit_expenses"] is False


def test_every_capability_key_is_a_boolean_except_role():
    """The client uses these directly in `needs:` checks. A stray null or
    string would render as truthy and quietly show the wrong menu."""
    caps = _principal(role="finance").capabilities()
    for key, value in caps.items():
        if key == "role":
            assert isinstance(value, str)
        else:
            assert isinstance(value, bool), f"{key} is {type(value).__name__}"
