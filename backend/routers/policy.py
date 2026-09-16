import logging
from datetime import datetime
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
import policy_rag
from ai_provider import TEXT, call_ai_json
from config import POLICY_RETRIEVAL_MODE, _policy_cache
from db import db, offload
from deps import Principal, get_principal, require_finance, require_policy_editor
from services.policy import PolicyUnavailable, current_policy_version, get_policy, get_policy_context, get_policy_record, ingest_policy_chunks, retrieve_policy_chunks
from services.receipts import extract_text_from_pdf

logger = logging.getLogger(__name__)

router = APIRouter()


# ───────────────── POLICY ─────────────────


@router.post("/upload-policy")
async def upload_policy(
    file: UploadFile = File(...),
    company_id: str = Form("default"),
    principal: Principal = Depends(require_policy_editor),
):
    # The policy IS the enforcement engine, so its write path is the most
    # sensitive endpoint in the service: whoever controls this text controls
    # every verdict. company_id comes from the caller's profile, never from
    # the form -- otherwise a finance user at one company could overwrite
    # another company's policy by editing a form field.
    company_id = principal.company_id
    pdf_bytes = await file.read()
    # PyPDF2 is CPU-bound and a long policy is the slowest parse in the
    # service; it does not belong on the event loop.
    text = await offload(extract_text_from_pdf, pdf_bytes)

    if not text.strip():
        raise HTTPException(
            status_code=400,
            detail="No readable text found in the PDF. Upload a text-based policy PDF (not only scanned images)."
        )

    now_iso = datetime.utcnow().isoformat()
    # A new upload is a new version. Verdicts cite the version in force when
    # they were made, so replacing a policy must not silently restate the
    # justification of decisions already taken against the old one.
    version = await offload(current_policy_version, company_id) + 1

    def _upsert_policy():
        # on_conflict is explicit because company_id is a UNIQUE constraint
        # rather than the primary key on this table. PostgREST resolves an
        # upsert against the primary key by default, so without naming the
        # column the second upload for a company arrives as a plain insert
        # and dies on "duplicate key value violates policies_company_id_key".
        # The first upload always worked, which is why this stayed hidden.
        return db().table("policies").upsert({
            "company_id": company_id,
            "policy_text": text,
            "file_name": file.filename,
            "uploaded_at": now_iso,
            "version": version,
        }, on_conflict="company_id").execute()

    await offload(_upsert_policy)

    _policy_cache.set(str(company_id or "default"), text)

    # Chunk and embed once, here, rather than re-scanning the whole policy on
    # every audit the way the keyword trimmer did.
    ingestion = {"chunks": 0, "embedded": 0}
    try:
        ingestion = await ingest_policy_chunks(company_id, text, version)
    except Exception:
        # The policy itself is saved and auditing still works through the
        # keyword path, so a failed ingest must not fail the upload -- but it
        # has to be visible, not swallowed.
        logger.exception("policy chunk ingestion failed for %s v%s",
                         company_id, version)

    return {
        "success": True,
        "preview": text[:300],
        "file_name": file.filename,
        "uploaded_at": now_iso,
        "characters": len(text),
        "version": version,
        "chunks": ingestion.get("chunks", 0),
        "embedded": ingestion.get("embedded", 0),
        "retrieval_mode": POLICY_RETRIEVAL_MODE,
    }


@router.get("/policy/{company_id}")
def fetch_policy(company_id: str, principal: Principal = Depends(get_principal)):
    # Readable by every role -- employees are expected to read the policy they
    # are judged against -- but only their own company's. The path parameter
    # is ignored in favour of the caller's profile so it cannot be used to
    # enumerate other companies' policies.
    company_id = principal.company_id
    try:
        record = get_policy_record(company_id)
    except PolicyUnavailable:
        raise HTTPException(
            status_code=503,
            detail="Could not load the company policy. Please try again shortly.")
    if not record:
        return {"exists": False, "policy": None}

    return {
        "exists": True,
        "policy": record.get("policy_text", ""),
        "file_name": record.get("file_name"),
        "uploaded_at": record.get("uploaded_at"),
        "preview": (record.get("policy_text") or "")[:300],
    }


# ───────────────── POLICY Q&A ─────────────────


@router.post("/policy/ask")
async def ask_policy(payload: dict = Body(...), principal: Principal = Depends(get_principal)):
    """Ask a natural-language question about the company expense policy."""
    question = str(payload.get("question") or "").strip()
    company_id = principal.company_id
    if not question:
        raise HTTPException(status_code=400, detail="question is required")
    if len(question) > 600:
        question = question[:600]

    policy_text = await offload(get_policy, company_id)
    # Q&A always uses retrieval where it is available, including in shadow
    # mode: unlike an audit, nothing here writes a decision, so there is no
    # reason to hold it back behind the comparison period.
    version = await offload(current_policy_version, company_id)
    retrieved = await retrieve_policy_chunks(
        company_id, version, {"business_purpose": question})

    if retrieved:
        policy_context = policy_rag.format_chunks_for_prompt(retrieved)
        citation_rule = (
            "cited_chunk_id (the number in the [chunk N] header of the passage "
            "your answer rests on, or null if none of them cover it),\n")
    else:
        policy_context = get_policy_context(
            policy_text, {"business_purpose": question})
        citation_rule = ""

    prompt = f"""You are a company expense policy assistant. Answer the employee's question using ONLY the policy text below.

Policy:
{policy_context}

Question: {question}

Return JSON only with keys:
answer (concise, business-readable, max 4 sentences),
policy_snippet (the most relevant quoted policy line, or null),
{citation_rule}confidence (one of: High, Medium, Low)

If the policy does not cover the question, say so clearly and set confidence to Low."""

    try:
        result = await call_ai_json(
            messages=[{"role": "user", "content": prompt}],
            task=TEXT,
            max_tokens=1500,
            temperature=0,
        )
    except Exception:
        raise HTTPException(
            status_code=503, detail="Policy assistant is temporarily unavailable. Try again shortly.")

    snippet = result.get("policy_snippet")
    section = None
    confidence = str(result.get("confidence") or "Low")

    chunk = policy_rag.verify_citation(result.get("cited_chunk_id"), retrieved)
    if chunk is not None:
        # Quote the document, not the model's recollection of it.
        snippet = (chunk.get("content") or "")[:600]
        section = chunk.get("section_path")
    elif retrieved:
        # Retrieval ran and the answer still cites nothing verifiable. Say so
        # through confidence rather than presenting it as grounded.
        confidence = "Low"

    return {
        "answer": str(result.get("answer") or "The policy does not clearly address this question."),
        "policy_snippet": snippet,
        "policy_section": section,
        "confidence": confidence,
    }
