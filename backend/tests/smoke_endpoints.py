"""Live endpoint sweep against a running server.

Not part of the pytest suite -- it needs a real database, real API keys and a
real HTTP server, and it creates then deletes a throwaway account. Run it by
hand when you want to know that a deployment is genuinely working end to end:

    python tests/smoke_endpoints.py

Every request is made with a token minted for a temporary user in a
throwaway company, so nothing it does can touch real data. The account and
everything it created are removed at the end, including on failure.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402  (comes with the openai/supabase dependency tree)

import config  # noqa: E402  loads .env
from db import db, supabase  # noqa: E402

BASE = os.getenv("SMOKE_BASE_URL", "http://127.0.0.1:8000")
COMPANY = f"smoke-{uuid.uuid4().hex[:8]}"
PASSWORD = "Smoke-Test-" + uuid.uuid4().hex[:12]

GREEN, RED, YELLOW, DIM, OFF = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"

results = []


def record(method, path, status, expected, note=""):
    ok = status in expected
    results.append((ok, method, path, status, note))
    mark = f"{GREEN}PASS{OFF}" if ok else f"{RED}FAIL{OFF}"
    exp = "" if ok else f" {DIM}(wanted {'/'.join(map(str, expected))}){OFF}"
    print(f"  {mark} {method:6s} {path:38s} -> {status}{exp}  {DIM}{note}{OFF}")
    return ok


def make_user(role):
    """Create a confirmed auth user + profile, and return (id, email)."""
    email = f"smoke-{uuid.uuid4().hex[:10]}@audixa-smoke.invalid"
    created = supabase.auth.admin.create_user({
        "email": email, "password": PASSWORD, "email_confirm": True,
    })
    uid = str(created.user.id)
    db().table("profiles").insert({
        "id": uid, "full_name": f"Smoke {role}", "role": role, "company_id": COMPANY,
    }).execute()
    return uid, email


def token_for(email):
    r = supabase.auth.sign_in_with_password({"email": email, "password": PASSWORD})
    return r.session.access_token


def main():
    print(f"\nAudixa endpoint sweep -> {BASE}")
    print(f"throwaway company: {COMPANY}\n")

    created_users = []
    try:
        emp_id, emp_email = make_user("employee"); created_users.append(emp_id)
        fin_id, fin_email = make_user("finance");  created_users.append(fin_id)
        adm_id, adm_email = make_user("admin");    created_users.append(adm_id)

        emp = {"Authorization": f"Bearer {token_for(emp_email)}"}
        fin = {"Authorization": f"Bearer {token_for(fin_email)}"}
        adm = {"Authorization": f"Bearer {token_for(adm_email)}"}

        c = httpx.Client(base_url=BASE, timeout=60.0)

        print("── public ──")
        record("GET", "/", c.get("/").status_code, {200})
        record("GET", "/health", c.get("/health").status_code, {200})
        record("GET", "/favicon.ico", c.get("/favicon.ico").status_code, {204})

        print("\n── auth boundary ──")
        record("GET", "/me (no token)", c.get("/me").status_code, {401},
               "must refuse")
        record("GET", "/me (bad token)",
               c.get("/me", headers={"Authorization": "Bearer nonsense"}).status_code,
               {401}, "must refuse")

        print("\n── identity ──")
        r = c.get("/me", headers=emp)
        caps = r.json().get("capabilities", {}) if r.status_code == 200 else {}
        record("GET", "/me", r.status_code, {200}, f"role={caps.get('role')}")
        assert caps.get("approve_claims") is False, "employee must not approve"
        record("GET", "/me (finance)", c.get("/me", headers=fin).status_code, {200})

        print("\n── employee surface ──")
        record("GET", "/claims/my", c.get("/claims/my", headers=emp).status_code, {200})
        record("GET", "/expenses", c.get("/expenses", headers=emp).status_code, {200})
        record("GET", "/expenses/available",
               c.get("/expenses/available", headers=emp).status_code, {200})
        record("GET", "/expenses/export.csv",
               c.get("/expenses/export.csv", headers=emp).status_code, {200})
        record("GET", "/trip-plans/my", c.get("/trip-plans/my", headers=emp).status_code, {200})
        record("GET", "/analytics/summary",
               c.get("/analytics/summary", headers=emp).status_code, {200})
        record("GET", "/policy/{id}", c.get(f"/policy/{COMPANY}", headers=emp).status_code, {200})
        record("GET", "/expenses/mileage-rate",
               c.get("/expenses/mileage-rate", headers=emp).status_code, {200},
               "no rate seeded for this company")

        print("\n── authorization: employee must be refused ──")
        for method, path in [("GET", "/claims"), ("GET", "/approvals"),
                             ("GET", "/finance/overview"), ("GET", "/admin/users"),
                             ("GET", "/admin/system"), ("GET", "/admin/fx-rates")]:
            record(method, f"{path} as employee",
                   c.request(method, path, headers=emp).status_code, {403})
        record("POST", "/upload-policy as employee",
               c.post("/upload-policy", headers=emp,
                      files={"file": ("p.pdf", b"%PDF", "application/pdf")}).status_code,
               {403})

        print("\n── approver surface ──")
        record("GET", "/claims", c.get("/claims", headers=fin).status_code, {200})
        record("GET", "/approvals", c.get("/approvals", headers=fin).status_code, {200})
        record("GET", "/finance/overview",
               c.get("/finance/overview", headers=fin).status_code, {200})
        record("GET", "/admin/fx-rates", c.get("/admin/fx-rates", headers=fin).status_code, {200})
        record("GET", "/analytics?scope=all",
               c.get("/analytics/summary?scope=all", headers=fin).status_code, {200})

        print("\n── admin surface ──")
        record("GET", "/admin/users", c.get("/admin/users", headers=adm).status_code, {200})
        record("GET", "/admin/system", c.get("/admin/system", headers=adm).status_code, {200})
        record("POST", "/admin/users/{id}/role",
               c.post(f"/admin/users/{emp_id}/role", headers=adm,
                      json={"role": "manager"}).status_code, {200})
        record("POST", "role: self-change refused",
               c.post(f"/admin/users/{adm_id}/role", headers=adm,
                      json={"role": "employee"}).status_code, {400})
        record("POST", "role: bad value refused",
               c.post(f"/admin/users/{emp_id}/role", headers=adm,
                      json={"role": "wizard"}).status_code, {400})
        record("GET", "/admin/system as finance",
               c.get("/admin/system", headers=fin).status_code, {403},
               "finance is not admin")

        print("\n── write path ──")
        r = c.post("/claims", headers=emp,
                   data={"report_name": "Smoke claim", "entity": "Smoke",
                         "employee_name": "Smoke", "company_id": "ignored"})
        claim_id = r.json().get("claim", {}).get("id") if r.status_code == 200 else None
        record("POST", "/claims", r.status_code, {200}, f"id={str(claim_id)[:8]}")

        if claim_id:
            record("POST", "/claims/{id}/submit",
                   c.post(f"/claims/{claim_id}/submit", headers=emp).status_code, {200})

            # Paying before approval is the mistake the guard exists for, so
            # check it BEFORE the override that approves the claim. Ordering
            # matters here: the first draft of this sweep approved first and
            # then "failed" on a 200 that was entirely correct.
            record("POST", "reimburse before approval refused",
                   c.post(f"/claims/{claim_id}/reimbursement", headers=fin,
                          json={"status": "Scheduled"}).status_code, {400},
                   "claim is not Approved yet")

            # Finance approving an EMPLOYEE's claim is the normal path.
            record("POST", "/claims/{id}/override",
                   c.post(f"/claims/{claim_id}/override", headers=fin,
                          json={"status": "Approved"}).status_code, {200},
                   "approver acting on someone else's claim")

            record("POST", "/claims/{id}/reimbursement",
                   c.post(f"/claims/{claim_id}/reimbursement", headers=fin,
                          json={"status": "Scheduled"}).status_code, {200},
                   "now Approved, so payment may be scheduled")

            # ...but never on their own. This is the self-approval fence.
            own = c.post("/claims", headers=fin,
                         data={"report_name": "Finance own claim", "entity": "Smoke",
                               "employee_name": "Smoke finance"})
            own_id = own.json().get("claim", {}).get("id") if own.status_code == 200 else None
            if own_id:
                record("POST", "override OWN claim refused",
                       c.post(f"/claims/{own_id}/override", headers=fin,
                              json={"status": "Approved"}).status_code, {403},
                       "an approver cannot decide their own money")

            # And never across a company boundary.
            record("POST", "override unknown claim",
                   c.post(f"/claims/{uuid.uuid4()}/override", headers=fin,
                          json={"status": "Approved"}).status_code, {404})

        r = c.post("/expenses/mileage", headers=emp,
                   data={"distance": "40", "unit": "km",
                         "business_purpose": "Smoke test journey"})
        record("POST", "/expenses/mileage", r.status_code, {409},
               "no rate for this company -> refuses rather than inventing one")

        record("POST", "/policy/ask",
               c.post("/policy/ask", headers=emp,
                      json={"question": "Are taxis claimable?"}).status_code,
               {200, 503}, "503 if the AI provider is down")

        print("\n── input validation ──")
        record("POST", "mileage: zero distance",
               c.post("/expenses/mileage", headers=emp,
                      data={"distance": "0", "business_purpose": "x"}).status_code, {400})
        record("POST", "mileage: absurd distance",
               c.post("/expenses/mileage", headers=emp,
                      data={"distance": "999999", "business_purpose": "x"}).status_code, {400})
        record("POST", "policy/ask: empty question",
               c.post("/policy/ask", headers=emp, json={"question": ""}).status_code, {400})
        record("GET", "/receipts/{unknown}",
               c.get(f"/receipts/{uuid.uuid4()}", headers=emp).status_code, {404})

        c.close()

    finally:
        print(f"\n{DIM}cleaning up {COMPANY}…{OFF}")
        for table in ("expenses", "claims", "policy_chunks", "travel_plans"):
            try:
                db().table(table).delete().eq("company_id", COMPANY).execute()
            except Exception:
                pass
        for uid in created_users:
            try:
                db().table("profiles").delete().eq("id", uid).execute()
                supabase.auth.admin.delete_user(uid)
            except Exception as e:
                print(f"  {YELLOW}could not delete {uid}: {str(e)[:70]}{OFF}")

    passed = sum(1 for ok, *_ in results if ok)
    total = len(results)
    print(f"\n{'─' * 62}")
    if passed == total:
        print(f"{GREEN}{passed}/{total} checks passed{OFF}\n")
        return 0
    print(f"{RED}{passed}/{total} passed — {total - passed} failed{OFF}")
    for ok, method, path, status, note in results:
        if not ok:
            print(f"  {RED}FAIL{OFF} {method} {path} -> {status}")
    print()
    return 1


if __name__ == "__main__":
    sys.exit(main())
