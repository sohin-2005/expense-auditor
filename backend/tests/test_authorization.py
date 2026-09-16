"""Locks on the authorization gates added in Phase 00.

Before these existed, role was enforced only by `isFinance` in App.jsx — in
the browser, where the user controls it. Any signed-in employee could approve
their own claim, overwrite the company policy, or read company-wide spend with
a plain HTTP call.

Each test below names the specific call that used to succeed. They assert on
behaviour reachable without a database: the role gate and the scope decision
both run before any query, so a Supabase client is never needed. Where a test
does need a row back, the table call is faked rather than mocked deeply — the
point is the gate, not the query.
"""


import pytest
from fastapi import HTTPException

import deps
import routers.admin as admin_routes
import routers.analytics as analytics_routes
import routers.claims as claim_routes


EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111"
APPROVER_ID = "22222222-2222-2222-2222-222222222222"


class _FakeUser:
    def __init__(self, user_id):
        self.id = user_id


def _principal(role="employee", company_id="acme", user_id=EMPLOYEE_ID):
    return deps.Principal(
        _FakeUser(user_id),
        {"id": user_id, "role": role, "company_id": company_id},
    )


# ───────────────── the role gate ─────────────────


@pytest.mark.parametrize("role", ["employee", "", None, "admin", "FINANCE_TEAM", "financial"])
def test_require_finance_rejects_non_approvers(role):
    """Only 'manager' or 'finance' pass.

    The odd-looking cases are deliberate: role is free text in a database
    column, so an invented value ('admin') or a near-miss ('financial',
    'FINANCE_TEAM') must fail closed rather than fuzzily match. Empty and
    None fall back to 'employee' in Principal, which is also unprivileged.
    """
    principal = _principal(role=role)
    with pytest.raises(HTTPException) as exc:
        deps.require_finance(principal)
    assert exc.value.status_code == 403


@pytest.mark.parametrize("role", ["manager", "finance", "Finance", "  MANAGER  "])
def test_require_finance_allows_approvers(role):
    """Case and surrounding whitespace are normalized, so a row written as
    'Finance' by hand in the SQL editor still works."""
    principal = _principal(role=role)
    assert deps.require_finance(principal) is principal


def test_role_is_read_from_profile_not_from_the_caller():
    """Principal takes its role from the profile row it is handed.

    The guarantee this encodes: nothing the client sends — form field, body
    key, header — feeds this value. It comes from the database row that
    load_profile() reads server-side.
    """
    principal = deps.Principal(
        _FakeUser(EMPLOYEE_ID),
        {"id": EMPLOYEE_ID, "role": "employee", "company_id": "acme"},
    )
    assert principal.role == "employee"
    assert principal.is_privileged is False


def test_missing_profile_row_is_refused_not_defaulted(monkeypatch):
    """No profile => 403.

    Defaulting a profile-less caller to 'employee' would be the tempting
    read, but it would mean a user whose row failed to insert at signup gets
    silently treated as a valid, if unprivileged, account.
    """
    class _Table:
        def select(self, *a, **k): return self
        def eq(self, *a, **k): return self
        def limit(self, *a, **k): return self
        def execute(self): return type("R", (), {"data": []})()

    monkeypatch.setattr(deps, "db", lambda: type("DB", (), {"table": lambda s, n: _Table()})())

    with pytest.raises(HTTPException) as exc:
        deps.load_profile(EMPLOYEE_ID)
    assert exc.value.status_code == 403


def test_profile_read_failure_fails_closed(monkeypatch):
    """A Supabase outage during the profile read must 503, not fall through.

    Everywhere else in main.py a failed read is swallowed and a default
    returned. Doing that here would hand out the employee path — or, worse,
    whatever the caller asked for — during a database blip.
    """
    def _boom():
        raise RuntimeError("connection reset")

    monkeypatch.setattr(deps, "db", lambda: _boom())

    with pytest.raises(HTTPException) as exc:
        deps.load_profile(EMPLOYEE_ID)
    assert exc.value.status_code == 503
    # And it must not leak the underlying driver message to the client.
    assert "connection reset" not in str(exc.value.detail)


# ───────────────── AUD-01: self-approval ─────────────────


def test_approver_cannot_override_their_own_claim(monkeypatch):
    """The call this whole phase exists to stop.

    A finance user is legitimately allowed to override claims — but not their
    own. require_finance alone would let them, since they genuinely hold the
    role.
    """
    approver = _principal(role="finance", company_id="acme", user_id=APPROVER_ID)

    monkeypatch.setattr(
        deps, "_fetch_claim",
        lambda claim_id: {
            "id": claim_id,
            "employee_id": APPROVER_ID,   # their own claim
            "company_id": "acme",
            "status": "Pending Approval",
        },
    )

    with pytest.raises(HTTPException) as exc:
        claim_routes.override_claim(
            claim_id="claim-1", status="Approved", comment="", principal=approver,
        )
    assert exc.value.status_code == 403
    assert "your own claim" in exc.value.detail.lower()


def test_override_rejects_claim_from_another_company(monkeypatch):
    """Cross-tenant override. 404 rather than 403 on purpose: confirming that
    a claim id exists but belongs elsewhere is itself a small leak."""
    approver = _principal(role="finance", company_id="acme", user_id=APPROVER_ID)

    monkeypatch.setattr(
        deps, "_fetch_claim",
        lambda claim_id: {
            "id": claim_id,
            "employee_id": EMPLOYEE_ID,
            "company_id": "globex",       # different company
            "status": "Pending Approval",
        },
    )

    with pytest.raises(HTTPException) as exc:
        claim_routes.override_claim(
            claim_id="claim-1", status="Approved", comment="", principal=approver,
        )
    assert exc.value.status_code == 404


def test_override_validates_status_before_touching_the_database(monkeypatch):
    """An invalid status is a 400, and no claim lookup happens."""
    approver = _principal(role="finance", user_id=APPROVER_ID)

    def _should_not_run(claim_id):
        raise AssertionError("claim was fetched before the status was validated")

    monkeypatch.setattr(deps, "_fetch_claim", _should_not_run)

    with pytest.raises(HTTPException) as exc:
        claim_routes.override_claim(
            claim_id="claim-1", status="Escalated", comment="", principal=approver,
        )
    assert exc.value.status_code == 400


# ───────────────── AUD-03: scope escalation ─────────────────


def _capture_rpc_args(monkeypatch):
    """Record the arguments analytics_summary passes to the aggregation RPC.

    Aggregation moved into Postgres in Phase 02, so scope is no longer
    expressed as .eq() filters on a query builder -- it is the p_employee_id
    argument: the caller's id for own-data, NULL for company-wide. That
    argument is now the thing worth asserting on.
    """
    captured = {}

    class _DB:
        def rpc(self, name, params):
            captured["name"] = name
            captured["params"] = params
            return self

        def execute(self):
            return type("R", (), {"data": {}})()

    monkeypatch.setattr(analytics_routes, "db", _DB)
    return captured


def test_scope_all_does_not_widen_scope_for_an_employee(monkeypatch):
    """`?scope=all` used to be the entire gate on company-wide analytics.

    Passing it as an employee must now return that employee's own data. The
    response reports which scope was actually applied, so an employee gets
    'mine' no matter what they ask for.
    """
    captured = _capture_rpc_args(monkeypatch)

    result = analytics_routes.analytics_summary(
        scope="all", principal=_principal(role="employee", user_id=EMPLOYEE_ID),
    )

    assert result["scope"] == "mine"
    # Scoped to the caller themselves. A non-null p_employee_id is what stops
    # the function aggregating the whole company.
    assert captured["name"] == "analytics_summary"
    assert captured["params"]["p_employee_id"] == EMPLOYEE_ID


def test_scope_all_is_company_scoped_even_for_approvers(monkeypatch):
    """'all' means the approver's own company, not every company sharing the
    database. The pre-fix query filtered by neither."""
    captured = _capture_rpc_args(monkeypatch)

    result = analytics_routes.analytics_summary(
        scope="all",
        principal=_principal(role="finance", company_id="acme", user_id=APPROVER_ID),
    )

    assert result["scope"] == "company"
    # NULL employee widens to the company -- and company_id still pins it to
    # the approver's own, never every company in the database.
    assert captured["params"]["p_employee_id"] is None
    assert captured["params"]["p_company_id"] == "acme"


# ───────────────── AUD-02 / ownership ─────────────────


def test_load_own_claim_rejects_someone_elses_claim(monkeypatch):
    """Backs the submit and attach paths: submitting or attaching to a claim
    you don't own used to be unchecked."""
    monkeypatch.setattr(
        deps, "_fetch_claim",
        lambda claim_id: {
            "id": claim_id,
            "employee_id": APPROVER_ID,   # somebody else's
            "company_id": "acme",
            "status": "Draft",
        },
    )

    with pytest.raises(HTTPException) as exc:
        deps.load_own_claim("claim-1", _principal(user_id=EMPLOYEE_ID))
    assert exc.value.status_code == 404


def test_load_own_claim_accepts_your_own(monkeypatch):
    monkeypatch.setattr(
        deps, "_fetch_claim",
        lambda claim_id: {
            "id": claim_id,
            "employee_id": EMPLOYEE_ID,
            "company_id": "acme",
            "status": "Draft",
        },
    )
    claim = deps.load_own_claim("claim-1", _principal(user_id=EMPLOYEE_ID))
    assert claim["id"] == "claim-1"


def test_missing_claim_is_not_found(monkeypatch):
    monkeypatch.setattr(deps, "_fetch_claim", lambda claim_id: None)

    with pytest.raises(HTTPException) as exc:
        deps.load_own_claim("nope", _principal(user_id=EMPLOYEE_ID))
    assert exc.value.status_code == 404


# ───────────────── role granting ─────────────────


def test_set_user_role_rejects_unknown_roles(monkeypatch):
    approver = _principal(role="finance", user_id=APPROVER_ID)
    with pytest.raises(HTTPException) as exc:
        admin_routes.set_user_role(
            user_id=EMPLOYEE_ID, role="superadmin", principal=approver,
        )
    assert exc.value.status_code == 400


def test_set_user_role_refuses_self_service(monkeypatch):
    """Self-demotion can strand a company with no approver, and the recovery
    path is the SQL editor."""
    approver = _principal(role="finance", company_id="acme", user_id=APPROVER_ID)
    monkeypatch.setattr(
        admin_routes, "load_profile",
        lambda uid: {"id": uid, "role": "finance", "company_id": "acme"},
    )

    with pytest.raises(HTTPException) as exc:
        admin_routes.set_user_role(
            user_id=APPROVER_ID, role="employee", principal=approver,
        )
    assert exc.value.status_code == 400


def test_set_user_role_refuses_across_companies(monkeypatch):
    approver = _principal(role="finance", company_id="acme", user_id=APPROVER_ID)
    monkeypatch.setattr(
        admin_routes, "load_profile",
        lambda uid: {"id": uid, "role": "employee", "company_id": "globex"},
    )

    with pytest.raises(HTTPException) as exc:
        admin_routes.set_user_role(
            user_id=EMPLOYEE_ID, role="finance", principal=approver,
        )
    assert exc.value.status_code == 404
