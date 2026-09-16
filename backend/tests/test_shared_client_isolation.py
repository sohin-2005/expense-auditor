"""Lock on the shared Supabase client never being demoted.

The bug this exists for: sign_in_with_password() MUTATES the client it is
called on, replacing that client's auth session with the signed-in user's
token. Calling it on the shared service-role client therefore demotes the
whole process -- every later auth.admin.* call runs as that user and fails
with "User not allowed".

It is invisible in isolation. The password check returns True, the endpoint
behaves, and the damage lands on some unrelated request minutes later. That
is exactly the kind of failure a test has to hold in place, because reading
the code will not reveal it twice.
"""
import inspect
import re

import db
import routers.profile as profile_routes
import routers.auth as auth_routes


def test_password_verification_uses_a_throwaway_client():
    """verify_password must construct its own client, never reuse the shared
    one."""
    source = inspect.getsource(db.verify_password)
    assert "create_client" in source, "must build its own client"
    # The shared handles are `supabase` and require_supabase(); neither may
    # appear as the thing being signed in to.
    assert "require_supabase()" not in source
    assert not re.search(r"(?<![\w.])supabase\.auth\.sign_in", source)


def test_no_router_signs_in_on_the_shared_client():
    """A single stray sign_in_with_password on the shared client silently
    breaks every admin operation that follows it in the same process."""
    for module in (profile_routes, auth_routes):
        source = inspect.getsource(module)
        offenders = re.findall(
            r"(?:require_supabase\(\)|(?<![\w.])supabase)\.auth\.sign_in_with_password",
            source)
        assert not offenders, (
            f"{module.__name__} signs in on the shared client "
            f"({len(offenders)} occurrence(s)) -- use db.verify_password()")


def test_verify_password_refuses_when_unconfigured(monkeypatch):
    """No credentials means no verification, and no verification means the
    change is refused rather than allowed."""
    monkeypatch.setattr(db, "SUPABASE_URL", None)
    assert db.verify_password("someone@example.com", "hunter2") is False


def test_verify_password_refuses_on_blank_input():
    assert db.verify_password("", "pw") is False
    assert db.verify_password("a@b.c", "") is False


def test_verify_password_returns_false_rather_than_raising(monkeypatch):
    """A wrong password and an unreachable auth service look the same from
    here. Both must refuse the change, and neither may escape as a 500."""
    monkeypatch.setattr(db, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(db, "SUPABASE_KEY", "service-key")

    import supabase as supabase_pkg

    def _boom(*a, **k):
        raise RuntimeError("auth unreachable")

    monkeypatch.setattr(supabase_pkg, "create_client", _boom)
    assert db.verify_password("a@b.c", "pw") is False
