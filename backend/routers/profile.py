import logging
import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile

import config
from db import db, offload, require_supabase, verify_password
from deps import Principal, get_principal
from domain.credentials import (SECURITY_QUESTIONS, hash_answer,
                                validate_password)

logger = logging.getLogger(__name__)

router = APIRouter()

AVATAR_BUCKET = "avatars"
AVATAR_URL_TTL_SECONDS = 600
MAX_AVATAR_BYTES = 3 * 1024 * 1024
ALLOWED_AVATAR_TYPES = {
    "image/jpeg": ".jpg", "image/png": ".png",
    "image/webp": ".webp", "image/gif": ".gif",
}

# Fields a person may change about themselves. company_id is absent on
# purpose: it is the tenant key, it decides whose data you can see, and it is
# an administrator's decision. company_name is the human label for the same
# organisation and is safe to edit.
EDITABLE = ("full_name", "phone", "job_title", "company_name")


def _avatar_url(path):
    if not path:
        return None
    try:
        res = require_supabase().storage.from_(AVATAR_BUCKET).create_signed_url(
            path, AVATAR_URL_TTL_SECONDS)
    except Exception:
        logger.warning("could not sign avatar %r", path, exc_info=True)
        return None
    if isinstance(res, dict):
        return res.get("signedURL") or res.get("signedUrl") or res.get("signed_url")
    return None


def _shape(profile: dict, email: str | None) -> dict:
    return {
        "id": profile.get("id"),
        "full_name": profile.get("full_name"),
        "email": email,
        "phone": profile.get("phone"),
        "job_title": profile.get("job_title"),
        "company_name": profile.get("company_name"),
        "company_id": profile.get("company_id"),
        "role": str(profile.get("role") or "employee").strip().lower(),
        "avatar_url": _avatar_url(profile.get("avatar_path")),
        "has_security_question": bool(profile.get("security_question")),
        "security_question": profile.get("security_question"),
        "updated_at": profile.get("updated_at"),
    }


def _email_of(user_id: str):
    """Look up one email.

    get_user_by_id, not list_users(): the old form fetched EVERY auth user in
    the project and linear-scanned it, which cost ~1s on this deployment and
    grows with the user table rather than with the request.
    """
    try:
        result = require_supabase().auth.admin.get_user_by_id(str(user_id))
        return str(getattr(result.user, "email", "") or "") or None
    except Exception:
        logger.warning("could not read email for %s", user_id, exc_info=True)
    return None


@router.get("/profile")
def get_profile(principal: Principal = Depends(get_principal)):
    """The caller's own profile.

    Role comes from the profiles row the server just read, not from anything
    the client remembered -- which is why the sidebar can stop showing a stale
    role after an administrator changes it.
    """
    try:
        rows = (db().table("profiles").select("*")
                .eq("id", principal.id).limit(1).execute().data or [])
    except Exception:
        logger.exception("profile read failed for %s", principal.id)
        raise HTTPException(status_code=503, detail="Could not load your profile.")
    if not rows:
        raise HTTPException(status_code=404, detail="Profile not found.")
    return _shape(rows[0], _email_of(principal.id))


@router.patch("/profile")
def update_profile(
    payload: dict = Body(...),
    principal: Principal = Depends(get_principal),
):
    """Update the caller's own details.

    Only the fields in EDITABLE are written. Anything else in the body is
    ignored rather than rejected -- role and company_id in particular, which
    are pinned server-side and by the profiles trigger, so a client sending
    them would otherwise believe a save happened.
    """
    update = {}
    for field in EDITABLE:
        if field not in payload:
            continue
        value = payload.get(field)
        value = None if value is None else str(value).strip()
        if field == "full_name" and not value:
            raise HTTPException(status_code=400, detail="Your name cannot be empty.")
        if field == "phone" and value:
            # Permissive on format, strict on length: phone numbers vary far
            # more by country than any regex worth writing.
            if not re.fullmatch(r"[0-9+()\-.\s]{6,24}", value):
                raise HTTPException(
                    status_code=400,
                    detail="That does not look like a phone number.")
        update[field] = value or None

    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update.")
    update["updated_at"] = datetime.utcnow().isoformat()

    try:
        res = db().table("profiles").update(update).eq("id", principal.id).execute()
    except Exception:
        logger.exception("profile update failed for %s", principal.id)
        raise HTTPException(status_code=503, detail="Could not save your profile.")
    if not res.data:
        raise HTTPException(status_code=404, detail="Profile not found.")

    ignored = [k for k in payload if k not in EDITABLE]
    return {
        "profile": _shape(res.data[0], _email_of(principal.id)),
        # Named explicitly so a client is never left thinking it changed
        # something it cannot.
        "ignored_fields": ignored,
    }


@router.post("/profile/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    principal: Principal = Depends(get_principal),
):
    """Replace the caller's profile photo.

    Stored in a private bucket and served as a short-lived signed URL, like
    receipts: a photo of a colleague is not something to leave world-readable
    behind a guessable path.
    """
    mime = (file.content_type or "").lower().split(";")[0]
    if mime not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Upload a JPEG, PNG, WebP or GIF image.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="That file is empty.")
    if len(content) > MAX_AVATAR_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Keep the image under {MAX_AVATAR_BYTES // (1024 * 1024)} MB.")

    path = f"{principal.id}/{uuid.uuid4().hex}{ALLOWED_AVATAR_TYPES[mime]}"

    def _store():
        require_supabase().storage.from_(AVATAR_BUCKET).upload(
            path=path, file=content, file_options={"content-type": mime})

    try:
        await offload(_store)
    except Exception:
        logger.exception("avatar upload failed for %s", principal.id)
        raise HTTPException(
            status_code=503,
            detail=f"Could not store the image. Does the '{AVATAR_BUCKET}' "
                   "storage bucket exist?")

    def _save():
        return (db().table("profiles")
                .update({"avatar_path": path,
                         "updated_at": datetime.utcnow().isoformat()})
                .eq("id", principal.id).execute())

    res = await offload(_save)
    if not res.data:
        raise HTTPException(status_code=404, detail="Profile not found.")
    return {"avatar_url": _avatar_url(path)}


@router.post("/profile/password")
def change_password(
    current_password: str = Body(..., embed=True),
    new_password: str = Body(..., embed=True),
    principal: Principal = Depends(get_principal),
):
    """Change your own password.

    The current password is re-verified by signing in with it, not taken on
    trust from the session. A live access token proves who you were when you
    signed in; it does not prove the person at the keyboard now knows the
    password, which is exactly what an unattended laptop breaks.
    """
    try:
        validate_password(new_password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    email = _email_of(principal.id)
    if not email:
        raise HTTPException(status_code=503, detail="Could not verify your account.")

    if not verify_password(email, current_password):
        raise HTTPException(status_code=400, detail="Your current password is incorrect.")

    try:
        require_supabase().auth.admin.update_user_by_id(
            principal.id, {"password": new_password})
    except Exception:
        logger.exception("password change failed for %s", principal.id)
        raise HTTPException(status_code=503, detail="Could not update your password.")

    logger.info("password changed for %s", principal.id)
    return {"success": True}


@router.post("/profile/security-question")
def set_security_question(
    question: str = Body(..., embed=True),
    answer: str = Body(..., embed=True),
    current_password: str = Body(..., embed=True),
    principal: Principal = Depends(get_principal),
):
    """Set or replace the answer that unlocks a password reset.

    Password-confirmed, because this IS the reset path: someone who can
    silently change the answer can take the account later without ever
    knowing the password.
    """
    if question not in SECURITY_QUESTIONS:
        raise HTTPException(status_code=400, detail="Choose one of the offered questions.")

    email = _email_of(principal.id)
    if not email:
        raise HTTPException(status_code=503, detail="Could not verify your account.")
    if not verify_password(email, current_password):
        raise HTTPException(status_code=400, detail="Your current password is incorrect.")

    try:
        answer_hash = hash_answer(answer)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        db().table("profiles").update({
            "security_question": question,
            "security_answer_hash": answer_hash,
            "security_set_at": datetime.utcnow().isoformat(),
        }).eq("id", principal.id).execute()
    except Exception:
        logger.exception("security question update failed for %s", principal.id)
        raise HTTPException(status_code=503, detail="Could not save your security question.")

    return {"success": True, "question": question}
