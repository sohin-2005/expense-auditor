import logging
import os
import re
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool
from supabase import create_client
from config import BOOT_ERRORS, SUPABASE_KEY, SUPABASE_URL
from domain.util import FETCH_ALL_MAX_ROWS, POSTGREST_PAGE_SIZE

logger = logging.getLogger(__name__)


supabase = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        BOOT_ERRORS.append(f"Supabase client init failed: {e}")
else:
    BOOT_ERRORS.append(
        "Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY environment variables.")


def db():
    return require_supabase()


def require_supabase():
    if supabase is None:
        raise HTTPException(
            status_code=503,
            detail="Database not configured on server. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
        )
    return supabase


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


async def offload(fn, *args, **kwargs):
    """Run a blocking call off the event loop.

    Most handlers are plain `def`, so FastAPI threadpools them wholesale. The
    few that must stay `async def` -- because they await an upload or an AI
    call -- still reach blocking code underneath: the sync Supabase client,
    PyPDF2 parsing, disk writes. Those go through here.

    Without it, converting the handler to `async def` would be worse than
    leaving it sync: an `async def` handler runs directly on the event loop,
    so every blocking call inside it stalls the whole process.
    """
    return await run_in_threadpool(fn, *args, **kwargs)


def insert_row(table: str, payload: dict, what: str):
    """Insert one row, failing loudly on a schema mismatch.

    This replaces insert_expense/claim/travel_plan_with_schema_fallback --
    three near-identical functions that retried an insert up to twelve times,
    parsing the Postgres error text to find whichever column it complained
    about, dropping that column, and trying again. They were a clever answer
    to a schema that existed only inside a Supabase project and nowhere in
    version control.

    The cost was silent data loss: an expense whose `policy_snippet` column
    was missing got inserted without the policy_snippet, and the API returned
    success. In an auditing tool, the row that quietly lost its justification
    is exactly the row you cannot afford to lose it from.

    db/001_init.sql now defines every column the API writes, so a mismatch is
    a real deployment fault. It says so instead.
    """
    try:
        return db().table(table).insert(payload).execute()
    except HTTPException:
        raise
    except Exception as e:
        m = re.search(r"Could not find the '([^']+)' column", str(e))
        if m:
            logger.error(
                "%s insert failed: table %r has no column %r. Apply "
                "backend/db/001_init.sql.", what, table, m.group(1),
            )
            raise HTTPException(
                status_code=500,
                detail=f"{what} could not be saved: the database is missing the "
                       f"'{m.group(1)}' column. Apply backend/db/001_init.sql.",
            )
        logger.exception("%s insert failed", what)
        raise


def fetch_all_rows(build_query, page_size: int = POSTGREST_PAGE_SIZE,
                   max_rows: int = FETCH_ALL_MAX_ROWS):
    """Read every row of a query, not just the first page.

    PostgREST caps a response at db-max-rows -- 1000 on Supabase -- and
    returns HTTP 200 with no error, no header and no truncation flag. A bare
    .execute() on a large table therefore returns a silent prefix, which is
    how the CSV export came to hand people an "export" missing everything
    past their thousandth expense.

    Takes a builder rather than a query object so each page starts from a
    fresh one; PostgREST builders are not safely reusable across executes.
    """
    rows = []
    offset = 0
    while offset < max_rows:
        res = build_query().range(offset, offset + page_size - 1).execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            return rows
        offset += page_size

    logger.warning(
        "fetch_all_rows stopped at the %d-row ceiling; the result is truncated",
        max_rows)
    return rows

def verify_password(email: str, password: str) -> bool:
    """Check a password without touching the shared client's session.

    sign_in_with_password() MUTATES the client it is called on: it replaces
    that client's auth session with the signed-in user's token. Calling it on
    the shared service-role client therefore demotes the whole process --
    every later auth.admin.* call runs as that user and fails with "User not
    allowed", which is exactly what happened the first time this was written.

    A throwaway client is created per check so the blast radius is one
    request, and it is never used for anything else.
    """
    from supabase import create_client

    if not (SUPABASE_URL and SUPABASE_KEY and email and password):
        return False
    try:
        scratch = create_client(SUPABASE_URL, SUPABASE_KEY)
        scratch.auth.sign_in_with_password({"email": email, "password": password})
        return True
    except Exception:
        # A wrong password and an unreachable auth service look the same from
        # here. Both must refuse the change rather than allow it.
        logger.info("password verification failed for %s", email, exc_info=True)
        return False
