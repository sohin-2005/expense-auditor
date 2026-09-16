import hashlib
import logging

from fastapi import Depends, HTTPException, Header

from config import _auth_cache
from db import db, require_supabase

logger = logging.getLogger(__name__)


# ───────────────── AUTH ─────────────────


def _token_key(token: str) -> str:
    """Cache key for a bearer token.

    Hashed, not the token itself: a cache is a dictionary someone may one day
    dump in a debugger or a heap snapshot, and a raw access token there is a
    live credential.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_current_user(authorization: str = Header(None)):
    # Plain `def`, not `async def`: supabase.auth.get_user() is a blocking
    # HTTP round-trip, and this dependency runs on every authenticated
    # request. As `async def` it held the event loop for the whole token
    # check; FastAPI runs a sync dependency in its threadpool instead.
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    token = authorization.split(" ")[1]

    # ~600ms of round trip, on every request, for an answer that does not
    # change for the life of the token. See config.AUTH_CACHE_TTL_SECONDS for
    # why 30 seconds and what it costs.
    cached = _auth_cache.get(_token_key(token))
    if cached is not None:
        return cached

    try:
        user = require_supabase().auth.get_user(token)
        _auth_cache.set(_token_key(token), user.user)
        return user.user
    except HTTPException:
        # require_supabase()'s 503 is a server misconfiguration, not a bad
        # token. Reporting it as 401 sent people to re-login over and over
        # against a backend that had no database configured at all.
        raise
    except Exception:
        # Bare `except:` here also swallowed KeyboardInterrupt and SystemExit.
        logger.info("token validation failed", exc_info=True)
        raise HTTPException(401, "Invalid token")

# ───────────────── AUTHORIZATION ─────────────────

# Four roles, two axes of authority.
#
#   employee — their own expenses, claims and trips.
#   manager  — approves other people's money.
#   finance  — approves, plus owns the policy, the exchange rates and
#              company-wide reporting.
#   admin    — owns people and configuration: who exists, what role they
#              hold, and what state the deployment is in. Deliberately NOT a
#              superset of finance: separating "who can approve spend" from
#              "who can grant the power to approve spend" is the whole point
#              of having both, and an admin who could also approve could
#              quietly grant themselves the ability and use it.
EMPLOYEE_ROLE = "employee"
MANAGER_ROLE = "manager"
FINANCE_ROLE = "finance"
ADMIN_ROLE = "admin"

ALL_ROLES = (EMPLOYEE_ROLE, MANAGER_ROLE, FINANCE_ROLE, ADMIN_ROLE)

# Can act on other people's money.
PRIVILEGED_ROLES = frozenset({MANAGER_ROLE, FINANCE_ROLE})

# Can manage users, roles and deployment configuration.
ADMIN_ROLES = frozenset({ADMIN_ROLE})

# Can change the policy and the exchange rates everything is measured against.
POLICY_ROLES = frozenset({FINANCE_ROLE})

# Files their own expenses. Oversight roles deliberately do not.
SUBMITTER_ROLES = frozenset({EMPLOYEE_ROLE, MANAGER_ROLE})


class Principal:
    """The authenticated caller together with the role the SERVER says they have.

    Every privileged endpoint routes through this. The role is read from the
    profiles table on each request rather than taken from the token or from
    anything the client sends, because the client is exactly what this guards
    against: before this existed, role was enforced only by `isFinance` in
    App.jsx, so any signed-in employee could approve their own claim or
    overwrite the company policy with a plain HTTP call.
    """

    def __init__(self, user, profile: dict):
        self.user = user
        self.id = str(user.id)
        self.profile = profile
        self.role = str(profile.get("role") or "employee").strip().lower()
        self.company_id = str(profile.get("company_id") or "default")

    @property
    def is_privileged(self) -> bool:
        """Can act on other people's money."""
        return self.role in PRIVILEGED_ROLES

    @property
    def is_admin(self) -> bool:
        """Can manage users, roles and deployment configuration."""
        return self.role in ADMIN_ROLES

    @property
    def submits_expenses(self) -> bool:
        """Files their own receipts, claims, mileage and trips.

        False for finance and admin. Those are oversight roles: an admin who
        can also file and approve their own spend collapses the separation
        the four roles exist to create, and the navigation gets quieter for
        it -- nobody has to scroll past a Scan Receipt button they will never
        press. Someone in finance who genuinely travels should hold a second
        employee account, the same way they would in any expense system with
        real separation of duties.
        """
        return self.role in SUBMITTER_ROLES

    @property
    def can_edit_policy(self) -> bool:
        return self.role in POLICY_ROLES

    def capabilities(self) -> dict:
        """What this caller may do, as the server sees it.

        Sent to the client so the UI can render the right navigation from one
        authoritative answer instead of re-deriving it from a role string.
        It is a rendering hint only -- every endpoint still checks for itself.
        """
        return {
            "role": self.role,
            "submit_expenses": self.submits_expenses,
            "approve_claims": self.is_privileged,
            "view_company_analytics": self.is_privileged,
            "edit_policy": self.can_edit_policy,
            "manage_rates": self.can_edit_policy,
            "manage_users": self.is_admin,
            "view_system_config": self.is_admin,
        }


def invalidate_profile(user_id: str) -> None:
    """Drop a cached profile so a role change takes effect at once.

    Without this the TTL would be the mechanism rather than the floor, and an
    administrator would watch a role change appear to do nothing for half a
    minute.
    """
    _auth_cache.invalidate(f"profile:{user_id}")


def load_profile(user_id: str) -> dict:
    """Read the caller's profile row.

    Fails closed. Elsewhere in this file a Supabase read that raises is
    swallowed and a default returned, which is right for display data and
    wrong here: a database blip must not quietly hand someone the
    employee-default path mid-approval, nor the reverse. A caller with no
    profile row is refused rather than defaulted.
    """
    # The other ~950ms of per-request overhead. Same reasoning as the token
    # cache above, and invalidated explicitly whenever a role changes.
    cache_key = f"profile:{user_id}"
    cached = _auth_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        res = (
            db().table("profiles")
            .select("id,role,company_id,full_name")
            .eq("id", str(user_id))
            .limit(1)
            .execute()
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("profile lookup failed for user %s", user_id)
        raise HTTPException(
            status_code=503,
            detail="Could not verify your account permissions. Please try again shortly.",
        )

    rows = res.data or []
    if not rows:
        raise HTTPException(
            status_code=403,
            detail="No profile is associated with this account. Contact your finance team.",
        )
    _auth_cache.set(cache_key, rows[0])
    return rows[0]


def get_principal(user=Depends(get_current_user)) -> Principal:
    """Authenticated caller plus server-side role. Use instead of
    get_current_user wherever behaviour depends on who is asking.

    Sync for the same reason as get_current_user: load_profile() is a
    blocking database read on the request path.
    """
    return Principal(user, load_profile(user.id))


def require_finance(principal: Principal = Depends(get_principal)) -> Principal:
    """Gate for approvals, overrides and company-wide reads."""
    if not principal.is_privileged:
        raise HTTPException(
            status_code=403,
            detail="This action requires a manager or finance role.",
        )
    return principal


def require_policy_editor(principal: Principal = Depends(get_principal)) -> Principal:
    """Gate for the policy and the exchange rates.

    Narrower than require_finance: a manager approves against the rules, but
    does not get to rewrite them. The policy IS the enforcement engine, so
    editing it is the single most consequential write in the service.
    """
    if not principal.can_edit_policy:
        raise HTTPException(
            status_code=403,
            detail="Only the finance team can change the policy or exchange rates.",
        )
    return principal


def require_admin(principal: Principal = Depends(get_principal)) -> Principal:
    """Gate for user and configuration management.

    Separate from require_finance on purpose. If one role could both grant
    approval rights and approve, it could grant itself the rest.
    """
    if not principal.is_admin:
        raise HTTPException(
            status_code=403,
            detail="This action requires an administrator.",
        )
    return principal


def _fetch_claim(claim_id: str):
    try:
        res = (
            db().table("claims")
            .select("id,employee_id,company_id,status")
            .eq("id", claim_id)
            .limit(1)
            .execute()
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("claim lookup failed for %s", claim_id)
        raise HTTPException(
            status_code=503,
            detail="Could not load that claim. Please try again shortly.",
        )
    rows = res.data or []
    return rows[0] if rows else None


def load_claim_in_company(claim_id: str, company_id: str) -> dict:
    """A claim the caller's company owns, for approver-side actions.

    404 rather than 403 on a mismatch: telling an outsider that a claim id
    exists but belongs to someone else is itself a small leak.
    """
    claim = _fetch_claim(claim_id)
    if not claim or str(claim.get("company_id") or "default") != str(company_id):
        raise HTTPException(status_code=404, detail="Claim not found")
    return claim


def load_own_claim(claim_id: str, principal: Principal) -> dict:
    """A claim the caller personally owns, for employee-side actions."""
    claim = _fetch_claim(claim_id)
    if not claim or str(claim.get("employee_id") or "") != principal.id:
        raise HTTPException(status_code=404, detail="Claim not found")
    return claim

def require_submitter(principal: Principal = Depends(get_principal)) -> Principal:
    """Gate for filing your own expenses, claims, mileage and trips.

    Oversight roles are refused here, not merely un-linked in the navigation.
    Hiding a button is a rendering choice; this is the rule. Without it,
    "finance cannot submit expenses" would hold only for as long as nobody
    typed the URL.
    """
    if not principal.submits_expenses:
        raise HTTPException(
            status_code=403,
            detail=f"The {principal.role} role does not file its own expenses. "
                   "Use an employee account to submit a claim.",
        )
    return principal
