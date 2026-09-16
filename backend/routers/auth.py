import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Body, HTTPException

from db import db, offload, require_supabase
from domain.credentials import (SECURITY_QUESTIONS, hash_answer,
                                validate_password, verify_answer)

logger = logging.getLogger(__name__)

router = APIRouter()

# A wrong answer must be cheap for the owner and expensive for everyone else.
MAX_ATTEMPTS_PER_HOUR = 5

# Every failure path in this router returns the same message and the same
# status. Saying "no account with that email" turns the reset form into a
# membership oracle: an attacker learns which addresses are registered without
# ever needing a password.
GENERIC_FAILURE = ("That email and answer combination was not recognised. "
                   "Check both, or ask your administrator to reset it for you.")


def _normalize_company(raw: str) -> str:
    """Fold the case differences that were silently splitting tenants.

    company_id is the key everything is scoped by, and signup took it as free
    text -- so 'Google' and 'google' became two isolated companies whose users
    could not see each other's claims. Existing rows keep whatever they have;
    this only stops new ones diverging.
    """
    return str(raw or "").strip().lower() or "default"


@router.get("/auth/security-questions")
def list_security_questions():
    """The questions offered at registration."""
    return {"questions": SECURITY_QUESTIONS}


@router.post("/auth/register")
def register(
    email: str = Body(..., embed=True),
    password: str = Body(..., embed=True),
    full_name: str = Body(..., embed=True),
    company_id: str = Body(..., embed=True),
    security_question: str = Body(..., embed=True),
    security_answer: str = Body(..., embed=True),
):
    """Create an account, its profile, and its recovery answer in one step.

    Server-side rather than from the browser, for three reasons the old
    client-side signup could not satisfy: the role is set here and cannot be
    chosen, the security answer is hashed before it is ever stored, and
    company_id is normalised so 'Google' and 'google' stop becoming separate
    companies.
    """
    email = str(email or "").strip().lower()
    full_name = str(full_name or "").strip()
    company_id = _normalize_company(company_id)

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email is required.")
    if not full_name:
        raise HTTPException(status_code=400, detail="Your full name is required.")
    if security_question not in SECURITY_QUESTIONS:
        raise HTTPException(status_code=400, detail="Choose one of the offered questions.")

    try:
        validate_password(password)
        answer_hash = hash_answer(security_answer)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    sb = require_supabase()
    try:
        created = sb.auth.admin.create_user({
            "email": email, "password": password, "email_confirm": True,
        })
    except Exception as e:
        message = str(e).lower()
        if "already" in message or "registered" in message or "exists" in message:
            raise HTTPException(
                status_code=409,
                detail="An account with that email already exists. Try signing in.")
        logger.exception("account creation failed for %s", email)
        raise HTTPException(
            status_code=503, detail="Could not create the account. Please try again shortly.")

    user_id = str(created.user.id)
    try:
        db().table("profiles").insert({
            "id": user_id,
            "full_name": full_name,
            # Always employee. Roles are granted by an administrator; the
            # picker that used to sit on the signup form let anyone choose
            # finance, which was the entire authorization model.
            "role": "employee",
            "company_id": company_id,
            "security_question": security_question,
            "security_answer_hash": answer_hash,
            "security_set_at": datetime.utcnow().isoformat(),
        }).execute()
    except Exception:
        # An auth user with no profile cannot sign in to anything -- every
        # request fails load_profile with a 403 -- so leaving one behind is
        # worse than failing loudly here.
        logger.exception("profile creation failed for %s; rolling back auth user", email)
        try:
            sb.auth.admin.delete_user(user_id)
        except Exception:
            logger.error("could not roll back auth user %s -- it now has no profile", user_id)
        raise HTTPException(
            status_code=503, detail="Could not finish setting up your account.")

    logger.info("account created %s company=%s", user_id, company_id)
    return {"success": True, "email": email, "company_id": company_id}


@router.post("/auth/forgot-password")
def forgot_password(email: str = Body(..., embed=True)):
    """Return the security question for an account, if it has one.

    Deliberately returns 200 with a question either way. An endpoint that
    404s on an unknown address is a free membership check, and this one is
    unauthenticated by necessity.
    """
    email = str(email or "").strip().lower()
    profile = _profile_for_email(email)

    if profile and profile.get("security_question"):
        return {"question": profile["security_question"], "email": email}

    # A stable decoy, chosen from the email so the same address always gets
    # the same question. A rotating one would reveal the account is fake.
    decoy = SECURITY_QUESTIONS[sum(map(ord, email)) % len(SECURITY_QUESTIONS)]
    return {"question": decoy, "email": email}


@router.post("/auth/reset-password")
def reset_password(
    email: str = Body(..., embed=True),
    answer: str = Body(..., embed=True),
    new_password: str = Body(..., embed=True),
):
    """Set a new password after a correct security answer."""
    email = str(email or "").strip().lower()
    try:
        validate_password(new_password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    profile = _profile_for_email(email)
    if not profile or not profile.get("security_answer_hash"):
        # Same shape and timing as a wrong answer.
        raise HTTPException(status_code=400, detail=GENERIC_FAILURE)

    user_id = str(profile["id"])
    if _recent_attempts(user_id) >= MAX_ATTEMPTS_PER_HOUR:
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Wait an hour, or ask your administrator "
                   "to reset your password.")

    ok = verify_answer(answer, profile["security_answer_hash"])
    _record_attempt(user_id, ok)
    if not ok:
        logger.warning("failed password reset for %s", user_id)
        raise HTTPException(status_code=400, detail=GENERIC_FAILURE)

    try:
        require_supabase().auth.admin.update_user_by_id(
            user_id, {"password": new_password})
    except Exception:
        logger.exception("password update failed for %s", user_id)
        raise HTTPException(
            status_code=503, detail="Could not update the password. Please try again shortly.")

    logger.info("password reset completed for %s", user_id)
    return {"success": True}


# ───────────────── helpers ─────────────────


def _profile_for_email(email: str):
    """Profile row for an email, or None. Never raises for an unknown address."""
    if not email:
        return None
    # This one genuinely needs the list: it maps an email to a user id, and
    # Supabase's admin API offers no lookup in that direction. It runs only on
    # the password-recovery path, which is rare and already rate-limited, so
    # the cost is acceptable here in a way it was not on /profile.
    try:
        users = require_supabase().auth.admin.list_users()
    except Exception:
        logger.exception("could not read auth users")
        return None

    user_id = next((str(u.id) for u in users
                    if str(getattr(u, "email", "") or "").lower() == email), None)
    if not user_id:
        return None

    try:
        rows = (db().table("profiles")
                .select("id,security_question,security_answer_hash")
                .eq("id", user_id).limit(1).execute().data or [])
    except Exception:
        logger.exception("profile lookup failed during recovery")
        return None
    return rows[0] if rows else None


def _recent_attempts(user_id: str) -> int:
    since = (datetime.utcnow() - timedelta(hours=1)).isoformat()
    try:
        rows = (db().table("password_reset_attempts").select("id")
                .eq("user_id", user_id).eq("succeeded", False)
                .gte("attempted_at", since).limit(50).execute().data or [])
        return len(rows)
    except Exception:
        # If the counter cannot be read, refuse rather than allow: an
        # unlimited reset endpoint is worse than an unavailable one.
        logger.exception("could not read reset attempts for %s", user_id)
        return MAX_ATTEMPTS_PER_HOUR


def _record_attempt(user_id: str, succeeded: bool) -> None:
    try:
        db().table("password_reset_attempts").insert({
            "user_id": user_id, "succeeded": succeeded,
        }).execute()
    except Exception:
        logger.exception("could not record reset attempt for %s", user_id)
