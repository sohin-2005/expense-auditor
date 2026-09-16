from datetime import datetime
from fastapi import APIRouter, Depends, Response

import ai_provider
import config
from deps import Principal, get_principal
from db import supabase

router = APIRouter()


@router.get("/")
def home():
    return {
        "service": "Audixa API",
        "status": "ok" if not config.BOOT_ERRORS else "degraded",
        "docs": "/docs",
    }




@router.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)


@router.get("/apple-touch-icon.png", include_in_schema=False)
def apple_touch_icon():
    return Response(status_code=204)


@router.get("/apple-touch-icon-precomposed.png", include_in_schema=False)
def apple_touch_icon_precomposed():
    return Response(status_code=204)


# ───────────────── HEALTH ─────────────────


@router.get("/health")
def health():
    return {
        "status": "ok" if not config.BOOT_ERRORS else "degraded",
        "supabase_configured": supabase is not None,
        "ai_providers": ai_provider.describe_providers(),
        "policy_retrieval_mode": config.POLICY_RETRIEVAL_MODE,
        "model_warnings": config.MODEL_WARNINGS,
        "boot_errors": config.BOOT_ERRORS,
        "time": datetime.utcnow().isoformat(),
    }


@router.get("/me")
def me(principal: Principal = Depends(get_principal)):
    """Who the caller is and what the server will let them do.

    The UI used to derive its navigation from `profile.role` read straight
    from Supabase in the browser. That worked, but it meant the client and
    the server each had their own opinion about what a role could do, and
    those opinions drifted. This is the server's answer, and the only one the
    UI should render from -- every endpoint still enforces independently, so
    a stale or tampered response changes what is drawn, never what is allowed.
    """
    return {
        "id": principal.id,
        "full_name": principal.profile.get("full_name"),
        "company_id": principal.company_id,
        "capabilities": principal.capabilities(),
    }
