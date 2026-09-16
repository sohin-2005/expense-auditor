"""Environment, tuning constants and the shared caches.

Split out of main.py so a module can read a setting without importing the
FastAPI app -- which is what made everything depend on everything.

Nothing here performs I/O beyond reading the environment. The Supabase client
lives in db.py, and the boot-time AI probe below only reads configuration.
"""
import logging
import os
import time
from pathlib import Path

from dotenv import load_dotenv

import ai_provider

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# Receipts belong in object storage, not on the container's disk. Render's
# filesystem is ephemeral: every deploy, restart and spin-down wipes it, so a
# disk-backed receipt leaves the expense row pointing at a file that no longer
# exists -- a broken evidence link in an audit tool, where the image IS the
# evidence. Local disk survives only as a degraded fallback (see
# store_receipt) and to keep already-uploaded files readable.
RECEIPT_BUCKET = (os.getenv("SUPABASE_RECEIPT_BUCKET") or "receipts").strip()
RECEIPT_URL_TTL_SECONDS = 300
LEGACY_UPLOAD_PREFIX = "/uploads/"

# Boot must never crash because of missing env vars — otherwise the whole
# deployment goes down and the frontend just sees "cannot reach backend".
# Clients are created defensively and /health reports what is misconfigured.
BOOT_ERRORS = []

# Populated by main.py's startup catalog check. Deliberately separate from
# BOOT_ERRORS: a transient catalog-read failure is not the same as a missing
# credential, and must not flip /health's status to "degraded".
#
# Mutated in place, never rebound. Readers hold this exact list object, so
# rebinding it in the startup hook would leave /health reporting the old one.
MODEL_WARNINGS = []

# A deployment with neither GEMINI_API_KEY nor GROQ_API_KEY set has zero AI
# capability -- permanent and operator-fixable, exactly like a missing
# Supabase credential, so it belongs in BOOT_ERRORS. This is deliberately
# narrower than MODEL_WARNINGS (populated below at startup): a transient
# catalog-read failure must not flip /health to "degraded" on its own, but
# "no provider configured at all" is known at import time and should.
#
# This runs at raw module scope during `import main`, before the FastAPI app
# exists -- there is no request/startup-hook try/except around it the way
# there is for the catalog check below. Boot must never crash here (that is
# the whole point of BOOT_ERRORS), so any failure building the config --
# load_config() itself is defensive, but a future change to it should not be
# able to take the import down -- is caught and recorded instead of raised.
try:
    _ai_config = ai_provider.get_config()
    if not _ai_config.text_chain and not _ai_config.vision_chain:
        BOOT_ERRORS.append(
            "No AI provider configured. Set GEMINI_API_KEY and/or GROQ_API_KEY "
            "environment variables.")
except Exception as e:
    BOOT_ERRORS.append(f"AI provider config failed to load: {e}")

FAST_MODE = os.getenv("EXPENSE_AUDIT_FAST_MODE", "1").strip().lower() in {
    "1", "true", "yes", "on"}

# Gemini 3.x spends 670-840 tokens on hidden reasoning before its first visible
# token, and that counts against max_tokens. These ceilings cover reasoning plus
# roughly 250 tokens of actual JSON. Groq stops well short of them.
OCR_MAX_TOKENS = 1800
AUDIT_MAX_TOKENS = 1500
TRIP_MAX_TOKENS = 2500

POLICY_CONTEXT_MAX_CHARS = 12000 if FAST_MODE else 18000
RECEIPT_PDF_MAX_PAGES = 8 if FAST_MODE else 20
RECEIPT_PDF_TEXT_MAX_CHARS = 7000 if FAST_MODE else 12000

# How policy context is selected for an audit:
#   "keyword" -- the original substring trimmer (db/005_policy_chunks.sql
#                explains why it was replaced)
#   "vector"  -- hybrid retrieval over policy_chunks
#   "shadow"  -- run both, use keyword, log where they disagree
#
# Shadow is the default on purpose. Policy retrieval decides whether people
# get reimbursed; it deserves a comparison period on real traffic before it
# decides anything. Switch to "vector" once the disagreement log looks right.
POLICY_RETRIEVAL_MODE = (
    os.getenv("POLICY_RETRIEVAL_MODE") or "shadow").strip().lower()
if POLICY_RETRIEVAL_MODE not in {"keyword", "vector", "shadow"}:
    BOOT_ERRORS.append(
        f"POLICY_RETRIEVAL_MODE={POLICY_RETRIEVAL_MODE!r} is not one of "
        "keyword, vector, shadow. Falling back to keyword.")
    POLICY_RETRIEVAL_MODE = "keyword"

POLICY_CACHE_TTL_SECONDS = 300

# Currency every aggregate is expressed in. Amounts are stored in both the
# original currency (what the employee's receipt says) and this one (what
# analytics can legitimately add up).
BASE_CURRENCY = (os.getenv("BASE_CURRENCY") or "USD").strip().upper() or "USD"
FX_CACHE_TTL_SECONDS = 900


class TTLCache:
    """Tiny TTL cache with a size bound.

    The policy cache used to be a bare module-level dict: never evicted, so
    it grew one permanent entry per company_id seen, and per-process, so
    workers drifted apart. Both are fine at one worker and one company and
    neither fails loudly when that stops being true.
    """

    def __init__(self, ttl_seconds: float, max_entries: int = 256):
        self.ttl = ttl_seconds
        self.max_entries = max_entries
        self._data: dict = {}

    def get(self, key):
        entry = self._data.get(key)
        if not entry:
            return None
        value, expires_at = entry
        if expires_at <= time.time():
            self._data.pop(key, None)
            return None
        return value

    def set(self, key, value):
        if len(self._data) >= self.max_entries:
            # Drop whatever expires soonest. Approximate, and cheap: this
            # cache is bounded in the hundreds, not the millions.
            oldest = min(self._data, key=lambda k: self._data[k][1])
            self._data.pop(oldest, None)
        self._data[key] = (value, time.time() + self.ttl)

    def invalidate(self, key):
        self._data.pop(key, None)


_policy_cache = TTLCache(POLICY_CACHE_TTL_SECONDS)
_fx_cache = TTLCache(FX_CACHE_TTL_SECONDS)

# ── auth caching ────────────────────────────────────────────────────────
# Every authenticated request used to pay two sequential Supabase round
# trips before the handler ran: ~600ms to validate the token and ~950ms to
# read the profile. Measured against this deployment, that made /me take
# 1.1s and /profile 2.0s while /health -- which touches neither -- answered
# in 7ms. The application was never the slow part; the distance to Supabase
# was.
#
# A token is a bearer credential that Supabase itself treats as valid for an
# hour, so re-verifying it on every request buys very little. Caching the
# result for a short window removes almost all of that cost.
#
# 30 seconds is the deliberate compromise. Long enough that a burst of
# requests -- a dashboard opening four endpoints at once -- pays the round
# trip once. Short enough that a signed-out token stops working promptly,
# and that an administrator changing someone's role sees it take effect
# within half a minute. Role changes also clear the entry explicitly, so in
# practice that is immediate; the TTL is the floor, not the mechanism.
AUTH_CACHE_TTL_SECONDS = 30

_auth_cache = TTLCache(AUTH_CACHE_TTL_SECONDS, max_entries=2048)
