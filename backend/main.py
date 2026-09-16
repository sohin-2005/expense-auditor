"""Audixa API — application assembly.

Routes live in routers/, business rules in domain/ and services/, shared
plumbing in config.py / db.py / deps.py. This file only wires them together,
so adding an endpoint no longer means growing a 2.6k-line module.
"""
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import ai_provider
import config
from config import UPLOAD_DIR

from routers import (admin, admin_overview, admin_people, analytics, auth, claims,
                     expenses, health, policy, profile, trips)

logger = logging.getLogger(__name__)

app = FastAPI(title="Audixa API", version="2.0.0")



@app.on_event("startup")
def _check_ai_model_catalog():
    """Warn loudly at boot if a configured model has fallen out of the
    account's catalog -- the failure mode that took the app down last time,
    surfaced here instead of as a 500 mid-upload.

    Must never block startup: a catalog-read failure (network blip, provider
    outage) is not a reason to refuse to serve traffic, so any exception is
    swallowed and recorded as a warning rather than raised.
    """
    try:
        config.MODEL_WARNINGS[:] = ai_provider.check_models()
    except Exception as e:
        config.MODEL_WARNINGS[:] = [f"model catalog check failed unexpectedly: {e}"]
    for warning in config.MODEL_WARNINGS:
        logger.warning("AI model catalog warning: %s", warning)

frontend_origins_env = os.getenv("FRONTEND_ORIGINS", "")
extra_frontend_origins = [
    o.strip() for o in frontend_origins_env.split(",") if o.strip()
]
default_frontend_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
allowed_frontend_origins = list(dict.fromkeys(
    default_frontend_origins + extra_frontend_origins
))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_frontend_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


# Router order is presentation only; FastAPI matches on path.
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(profile.router)
app.include_router(policy.router)
app.include_router(trips.router)
app.include_router(expenses.router)
app.include_router(claims.router)
app.include_router(admin.router)
app.include_router(admin_people.router)
app.include_router(admin_overview.router)
app.include_router(analytics.router)
