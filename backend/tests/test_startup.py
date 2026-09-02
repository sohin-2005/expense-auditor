from fastapi.testclient import TestClient

import main


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
