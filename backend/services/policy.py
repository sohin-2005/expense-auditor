import logging
import re
from fastapi import HTTPException
import ai_provider
import policy_rag
from ai_provider import AIUnavailableError
from config import POLICY_CONTEXT_MAX_CHARS, POLICY_RETRIEVAL_MODE, _policy_cache
from db import db, offload

logger = logging.getLogger(__name__)


class PolicyUnavailable(RuntimeError):
    """The policy could not be read. Distinct from "no policy uploaded":
    one is a transient fault, the other is a real, auditable state."""


def get_policy_record(company_id: str):
    try:
        res = (
            db().table("policies")
            .select("*")
            .eq("company_id", company_id)
            .order("uploaded_at", desc=True)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0]
    except HTTPException:
        raise
    except Exception as e:
        # Previously `except: pass`, which returned None and let get_policy()
        # fall through to "Standard business expense rules apply." -- so a
        # transient Supabase failure silently audited real expenses against
        # no policy at all and returned the verdict as if it were genuine.
        # A missing policy and an unreadable one are different answers.
        logger.exception("policy read failed for company %s", company_id)
        raise PolicyUnavailable(str(e))
    return None


DEFAULT_POLICY_TEXT = "Standard business expense rules apply."


def get_policy(company_id: str):
    """The company's policy text.

    Raises 503 if the policy cannot be READ. Returns the generic default only
    when no policy has genuinely been uploaded. Collapsing those two cases is
    what let a database blip produce confident verdicts backed by nothing.
    """
    key = str(company_id or "default")
    cached = _policy_cache.get(key)
    if cached:
        return cached

    try:
        record = get_policy_record(key)
    except PolicyUnavailable:
        raise HTTPException(
            status_code=503,
            detail="The company policy could not be read, so this expense cannot "
                   "be audited right now. Please try again shortly.",
        )

    if record and record.get("policy_text"):
        text = record["policy_text"]
        _policy_cache.set(key, text)
        return text

    logger.warning(
        "no policy uploaded for company %s; auditing against generic defaults", key)
    return DEFAULT_POLICY_TEXT


# ───────────────── POLICY RETRIEVAL (RAG) ─────────────────


def current_policy_version(company_id: str) -> int:
    record = get_policy_record(company_id)
    if not record:
        return 0
    try:
        return int(record.get("version") or 1)
    except (TypeError, ValueError):
        return 1


async def ingest_policy_chunks(company_id: str, policy_text: str, version: int) -> dict:
    """Chunk, embed and store a policy version.

    Runs once per upload rather than once per audit -- the old trimmer
    re-scanned the entire policy text on every single request.

    Chunks whose embedding failed are still stored, with a null vector: they
    remain findable by keyword search, so a partial embedding run degrades
    retrieval instead of losing part of the policy. The counts come back to
    the caller so the upload response can say what actually happened.
    """
    chunks = policy_rag.chunk_policy(policy_text)
    if not chunks:
        return {"chunks": 0, "embedded": 0}

    try:
        vectors = await policy_rag.embed_chunks(chunks)
    except AIUnavailableError as e:
        logger.warning("policy embedding unavailable: %s", e)
        vectors = [None] * len(chunks)

    rows = [{
        "company_id": company_id,
        "policy_version": version,
        "section_path": chunk.section_path,
        "chunk_index": chunk.chunk_index,
        "content": chunk.content,
        "token_estimate": chunk.token_estimate,
        "embedding": vector,
    } for chunk, vector in zip(chunks, vectors)]

    def _replace():
        # Idempotent per version: re-uploading the same version replaces its
        # chunks rather than doubling them.
        db().table("policy_chunks").delete().eq(
            "company_id", company_id).eq("policy_version", version).execute()
        for start in range(0, len(rows), 100):
            db().table("policy_chunks").insert(rows[start:start + 100]).execute()

    await offload(_replace)

    embedded = sum(1 for v in vectors if v is not None)
    logger.info("policy v%s ingested for %s: %d chunks, %d embedded",
                version, company_id, len(rows), embedded)
    return {"chunks": len(rows), "embedded": embedded}


async def retrieve_policy_chunks(company_id: str, version: int, payload: dict) -> list[dict]:
    """Hybrid search for the policy passages relevant to one expense.

    Returns [] when retrieval is unavailable for any reason -- no chunks
    ingested yet, the RPC missing, the embedding provider down. Callers treat
    an empty result as "fall back to the keyword trimmer" rather than as an
    error, so a half-configured deployment audits with the old behaviour
    instead of refusing to audit at all.
    """
    if version <= 0:
        return []

    query_text = policy_rag.build_retrieval_query(payload)
    if not query_text:
        return []

    try:
        vectors = await ai_provider.embed_texts([query_text])
        query_vector = vectors[0] if vectors else None
    except AIUnavailableError:
        query_vector = None
    except Exception:
        logger.exception("query embedding failed")
        query_vector = None

    def _search():
        return db().rpc("match_policy_chunks", {
            "p_company_id": company_id,
            "p_version": version,
            "p_query_embedding": query_vector,
            "p_query_text": query_text,
            "p_match_count": policy_rag.MATCH_COUNT,
            "p_candidates": policy_rag.CANDIDATE_COUNT,
        }).execute()

    try:
        res = await offload(_search)
    except Exception:
        logger.exception(
            "policy retrieval failed for %s v%s; falling back to keyword context",
            company_id, version)
        return []

    return res.data or []


async def build_policy_context(company_id: str, policy_text: str, payload: dict) -> tuple[str, list[dict]]:
    """Policy context for one audit, plus the chunks it was built from.

    The returned chunk list is what makes citations checkable: an id the
    model produces that is not in this list was not in front of it.
    An empty list means the prompt carried untagged text and no citation can
    be verified against it.
    """
    if POLICY_RETRIEVAL_MODE == "keyword":
        return get_policy_context(policy_text, payload), []

    version = await offload(current_policy_version, company_id)
    rows = await retrieve_policy_chunks(company_id, version, payload)

    if not rows:
        if POLICY_RETRIEVAL_MODE == "vector":
            logger.warning(
                "no policy chunks retrieved for %s v%s; using keyword context. "
                "Has the policy been re-uploaded since db/005_policy_chunks.sql?",
                company_id, version)
        return get_policy_context(policy_text, payload), []

    retrieved = policy_rag.format_chunks_for_prompt(rows)

    if POLICY_RETRIEVAL_MODE == "shadow":
        # Use the old path's output, but record what the new one would have
        # sent. Comparing sizes and section coverage on real traffic is the
        # cheapest useful signal before switching a decision-making component.
        keyword_context = get_policy_context(policy_text, payload)
        logger.info(
            "policy retrieval shadow company=%s version=%s keyword_chars=%d "
            "vector_chars=%d chunks=%d sections=%s",
            company_id, version, len(keyword_context), len(retrieved), len(rows),
            [r.get("section_path") for r in rows],
        )
        return keyword_context, []

    return retrieved, rows


def get_policy_context(policy_text: str, context_payload: dict, max_chars: int = POLICY_CONTEXT_MAX_CHARS):
    text = str(policy_text or "").strip()
    if not text:
        return "Standard business expense rules apply."
    if len(text) <= max_chars:
        return text

    query_bits = []
    for k in [
        "type", "expense_type", "category", "city", "vendor_name", "vendor",
        "business_purpose", "payment_type", "destination", "activities"
    ]:
        v = context_payload.get(k)
        if isinstance(v, list):
            query_bits.extend([str(x) for x in v])
        elif v is not None:
            query_bits.append(str(v))

    query = " ".join(query_bits).lower()
    words = [w for w in re.findall(r"[a-zA-Z]{3,}", query) if w]
    if not words:
        return text[:max_chars]

    chunks = [c.strip() for c in re.split(r"\n\s*\n+", text) if c.strip()]
    scored = []
    for chunk in chunks:
        cl = chunk.lower()
        score = 0
        for w in words:
            if w in cl:
                score += 1
        if score > 0:
            scored.append((score, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)
    selected = []
    size = 0
    for _, chunk in scored:
        if size + len(chunk) + 2 > max_chars:
            continue
        selected.append(chunk)
        size += len(chunk) + 2
        if size >= int(max_chars * 0.92):
            break

    if not selected:
        return text[:max_chars]
    return "\n\n".join(selected)
