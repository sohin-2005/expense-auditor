import logging
import uuid
import io
import PyPDF2
from pathlib import Path
from config import LEGACY_UPLOAD_PREFIX, RECEIPT_BUCKET, RECEIPT_URL_TTL_SECONDS, UPLOAD_DIR
from db import supabase

logger = logging.getLogger(__name__)


# ───────────────── UTIL ─────────────────


def extract_text_from_pdf(pdf_bytes: bytes, max_pages: int = 40, max_chars: int = 120000):
    try:
        reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))
        chunks = []
        for page in reader.pages[:max_pages]:
            try:
                chunks.append(page.extract_text() or "")
            except Exception:
                # One unreadable page should not lose the rest of the
                # document; callers check whether anything came back.
                logger.debug("PDF page extraction failed", exc_info=True)
                chunks.append("")
        return "\n".join(chunks)[:max_chars]
    except Exception:
        logger.warning("PDF could not be parsed", exc_info=True)
        return ""


# ───────────────── RECEIPT STORAGE ─────────────────


def store_receipt(content: bytes, filename: str, mime: str) -> str:
    """Persist an uploaded receipt; return the reference to store on the row.

    Two shapes come back, and readers tell them apart by prefix:
      * an object path in the Supabase bucket, e.g. "3f2b….jpg"
      * a legacy local path, e.g. "/uploads/3f2b….jpg"

    Storage is the intended path. Disk is a fallback for a deployment with no
    bucket configured, so a missing bucket degrades to today's behaviour
    instead of failing every upload -- but it logs, because anything written
    there is lost on the next deploy.
    """
    ext = Path(filename or "receipt").suffix or (".pdf" if "pdf" in mime else ".jpg")
    name = f"{uuid.uuid4()}{ext}"

    if supabase is not None:
        try:
            supabase.storage.from_(RECEIPT_BUCKET).upload(
                path=name,
                file=content,
                file_options={"content-type": mime or "application/octet-stream"},
            )
            return name
        except Exception:
            logger.exception(
                "receipt upload to bucket %r failed; falling back to ephemeral "
                "local disk. This file will be lost on the next deploy.",
                RECEIPT_BUCKET,
            )

    path = UPLOAD_DIR / name
    path.write_bytes(content)
    return f"{LEGACY_UPLOAD_PREFIX}{name}"


def resolve_receipt_url(stored: str) -> str | None:
    """Turn a stored reference into a URL the browser can open.

    Signed URLs are minted on read and expire, so nothing long-lived is
    persisted on the expense row -- a stored signed URL would go stale and
    break exactly the historical records this is meant to protect.
    """
    ref = str(stored or "").strip()
    if not ref:
        return None
    if ref.startswith("http://") or ref.startswith("https://"):
        return ref
    if ref.startswith(LEGACY_UPLOAD_PREFIX):
        # Pre-storage upload, still on disk if this container has not been
        # replaced yet. Served by the StaticFiles mount.
        return ref
    if supabase is None:
        return None

    try:
        res = supabase.storage.from_(RECEIPT_BUCKET).create_signed_url(
            ref, RECEIPT_URL_TTL_SECONDS
        )
    except Exception:
        logger.exception("could not sign receipt %r", ref)
        return None

    if isinstance(res, dict):
        # Key casing has moved around across supabase-py releases.
        return res.get("signedURL") or res.get("signedUrl") or res.get("signed_url")
    return None
