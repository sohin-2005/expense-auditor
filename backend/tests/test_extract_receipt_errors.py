import asyncio
import io

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

import main
from ai_provider import AIUnavailableError, TEXT, VISION


class _FakeUser:
    id = "00000000-0000-0000-0000-000000000000"


def _upload(filename, content_type, content=b"fake-bytes-not-a-real-file"):
    return UploadFile(
        filename=filename,
        file=io.BytesIO(content),
        headers=Headers({"content-type": content_type}),
    )


def _run_extract(up):
    return asyncio.run(main.extract_receipt(
        file=up,
        business_purpose="client meeting lunch",
        employee_name="Test User",
        company_id="default",
        claim_id="",
        user=_FakeUser(),
    ))


@pytest.fixture(autouse=True)
def _isolated_upload_dir(tmp_path, monkeypatch):
    """Redirect saved uploads to a throwaway directory.

    extract_receipt always writes the raw upload to disk before doing
    anything else; these tests must not litter the real backend/uploads/
    folder.
    """
    monkeypatch.setattr(main, "UPLOAD_DIR", tmp_path)


def test_vision_ai_unavailable_raises_503_with_vision_message(monkeypatch):
    """AIUnavailableError(task=VISION) -> 503 with the image-specific detail.

    This is the exact failure this project was built to fix: previously an
    image upload hitting a dead vision model surfaced as a bare 500. The
    handler must translate it into an honest, task-specific 503 instead.
    """
    def _boom(*args, **kwargs):
        raise AIUnavailableError(task=VISION, failures=["gemini/gemini-3.5-flash: boom"])

    monkeypatch.setattr(main, "call_ai_json", _boom)

    up = _upload("receipt.jpg", "image/jpeg")

    with pytest.raises(HTTPException) as exc_info:
        _run_extract(up)

    assert exc_info.value.status_code == 503
    assert "Image scanning is temporarily unavailable" in exc_info.value.detail
    assert "upload a PDF receipt" in exc_info.value.detail


def test_text_ai_unavailable_raises_503_with_text_message(monkeypatch):
    """AIUnavailableError(task=TEXT) -> 503 with the generic text-path detail.

    This path (both Gemini and Groq failing for a text/PDF task) has never
    been exercised live, so it needs a direct lock on the contract: the
    handler distinguishes it from the vision message.
    """
    def _boom(*args, **kwargs):
        raise AIUnavailableError(
            task=TEXT,
            failures=["gemini/gemini-3.5-flash: boom", "groq/qwen: boom"],
        )

    monkeypatch.setattr(main, "call_ai_json", _boom)
    # Avoid depending on real PDF parsing to reach the text-task call site.
    monkeypatch.setattr(main, "extract_text_from_pdf", lambda *a, **k: "some receipt text")

    up = _upload("receipt.pdf", "application/pdf")

    with pytest.raises(HTTPException) as exc_info:
        _run_extract(up)

    assert exc_info.value.status_code == 503
    assert "Receipt processing is temporarily unavailable" in exc_info.value.detail
    assert "Image scanning" not in exc_info.value.detail


def test_unexpected_error_raises_500_without_leaking_internal_detail(monkeypatch):
    """A non-HTTPException, non-AIUnavailableError failure -> 500, generic detail.

    The client-facing message must not echo the original exception text --
    that would leak internals (e.g. DB error strings) to the caller.
    """
    secret_detail = "psycopg2.OperationalError: password authentication failed for user 'prod_admin'"

    def _boom(*args, **kwargs):
        raise RuntimeError(secret_detail)

    monkeypatch.setattr(main, "call_ai_json", _boom)

    up = _upload("receipt.jpg", "image/jpeg")

    with pytest.raises(HTTPException) as exc_info:
        _run_extract(up)

    assert exc_info.value.status_code == 500
    assert secret_detail not in exc_info.value.detail
    assert "password" not in exc_info.value.detail
    assert "prod_admin" not in exc_info.value.detail
    assert "Receipt processing failed unexpectedly" in exc_info.value.detail
