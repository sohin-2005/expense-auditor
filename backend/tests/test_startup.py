import importlib

from fastapi.testclient import TestClient

import ai_provider
import main


def test_no_ai_provider_configured_marks_health_degraded(monkeypatch):
    """A deployment with neither GEMINI_API_KEY nor GROQ_API_KEY set has zero
    AI capability -- that must show up in boot_errors and flip /health to
    "degraded", the same way a missing Supabase credential does.

    Before this fix, that case fell through the cracks: BOOT_ERRORS stayed
    empty and /health reported "ok" while every AI feature in the product
    was dead. This reloads main.py with both keys cleared from the
    environment to exercise the actual module-scope check, then restores
    normal module state so later tests aren't affected.

    The pre-existing MODEL_WARNINGS/BOOT_ERRORS split must still hold: a
    transient catalog-read failure (test above) stays out of boot_errors,
    but "nothing configured at all" is a permanent, known-at-import-time
    misconfiguration and belongs in boot_errors.
    """
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setattr(ai_provider, "_ACTIVE_CONFIG", None)
    # main.py's module-scope load_dotenv() would otherwise repopulate both
    # keys from backend/.env on reload, undoing the deletions above.
    monkeypatch.setattr("dotenv.load_dotenv", lambda *a, **k: None)

    reloaded = importlib.reload(main)
    try:
        with TestClient(reloaded.app) as client:
            resp = client.get("/health")

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "degraded"
        assert any("No AI provider configured" in e for e in body["boot_errors"])
    finally:
        # Undo the env patch now (not at fixture teardown) so the reload
        # below picks up real config again before any other test imports
        # `main`.
        monkeypatch.undo()
        ai_provider._ACTIVE_CONFIG = None
        importlib.reload(main)


def test_startup_swallows_check_models_exception_and_app_still_serves(monkeypatch):
    """The startup catalog check must never be able to prevent boot.

    A network failure while reading the model catalog is exactly the kind of
    thing this check exists to surface -- it must not be able to take the
    app down with it. This locks down that failure-tolerance: even when
    check_models() raises, the app finishes starting, /health stays
    reachable, and the failure shows up as a warning instead of a crash.
    """
    def _boom(*args, **kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr(main.ai_provider, "check_models", _boom)

    with TestClient(main.app) as client:
        resp = client.get("/health")

    assert resp.status_code == 200
    body = resp.json()
    assert body["model_warnings"] == [
        "model catalog check failed unexpectedly: network down"
    ]
    # A catalog-read failure is not a missing-credential failure: it must
    # not be folded into boot_errors or flip status to "degraded" on its
    # own account.
    assert "model catalog check failed unexpectedly: network down" not in body["boot_errors"]
