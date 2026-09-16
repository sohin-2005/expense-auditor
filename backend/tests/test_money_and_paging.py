"""Locks on the Phase 02 correctness fixes.

Two silent-wrongness bugs and the machinery added to stop them:

  * analytics summed `amount` across currencies, so a Rs.5,000 taxi and a
    $5,000 flight counted equally (AUD-07).
  * every large read stopped at PostgREST's 1000-row cap with a plain HTTP
    200, so totals, exports and claim summaries silently lost everything
    past the first page (AUD-06).

Both failed quietly and looked plausible, which is what makes them worth
pinning down in tests rather than trusting to review.
"""

import time

import pytest
from fastapi import HTTPException

import config
import db as db_mod
import domain.money as money
import services.policy as policy


# ───────────────── FX conversion ─────────────────


def test_base_currency_expense_needs_no_rate_row(monkeypatch):
    """An expense already in the base currency converts at 1.0 without any
    fx_rates lookup — so a single-currency company works with an empty
    rates table."""
    monkeypatch.setattr(money, "BASE_CURRENCY", "USD")

    def _should_not_query():
        raise AssertionError("fx_rates was queried for a base-currency expense")

    monkeypatch.setattr(money, "db", _should_not_query)
    monkeypatch.setattr(money, "_fx_cache", config.TTLCache(60))

    rate, rate_date = money.lookup_fx_rate("USD", "2026-03-04")
    assert rate == 1.0
    assert rate_date == "2026-03-04"


def test_unknown_currency_yields_no_conversion(monkeypatch):
    """No rate on file must produce None, never a guess.

    This is the whole design rule: an expense nobody has given a rate for is
    excluded from base-currency totals and reported, rather than folded in at
    an implied 1:1.
    """
    monkeypatch.setattr(money, "BASE_CURRENCY", "USD")
    monkeypatch.setattr(money, "_fx_cache", config.TTLCache(60))
    monkeypatch.setattr(money, "db", _fx_db([]))

    rate, rate_date = money.lookup_fx_rate("INR", "2026-03-04")
    assert rate is None
    assert rate_date is None


def test_apply_fx_leaves_amount_base_null_when_unconvertible(monkeypatch):
    monkeypatch.setattr(money, "BASE_CURRENCY", "USD")
    monkeypatch.setattr(money, "_fx_cache", config.TTLCache(60))
    monkeypatch.setattr(money, "db", _fx_db([]))

    expense = money.apply_fx(
        {"amount": 5000, "currency": "INR", "transaction_date": "2026-03-04"})

    assert expense["amount_base"] is None
    assert expense["fx_rate"] is None
    # The original is untouched: the employee must still recognize their own
    # receipt.
    assert expense["amount"] == 5000
    assert expense["currency"] == "INR"


def test_apply_fx_converts_at_the_rate_on_file(monkeypatch):
    monkeypatch.setattr(money, "BASE_CURRENCY", "USD")
    monkeypatch.setattr(money, "_fx_cache", config.TTLCache(60))
    monkeypatch.setattr(
        money, "db", _fx_db([{"rate_to_base": 0.012, "rate_date": "2026-03-01"}]))

    expense = money.apply_fx(
        {"amount": 5000, "currency": "INR", "transaction_date": "2026-03-04"})

    assert expense["amount_base"] == 60.0
    assert expense["fx_rate"] == 0.012
    # The rate's own date, not the transaction date: this is the row that was
    # actually used, which is what makes the conversion auditable later.
    assert expense["fx_date"] == "2026-03-01"


def test_mixed_currency_claim_total_is_not_a_plain_sum():
    """The AUD-07 bug, stated directly.

    Rs.5,000 (=$60) plus $5,000 is $5,060, not 10,000 of nothing.
    """
    items = [
        {"amount": 5000, "amount_base": 60.0, "currency": "INR", "status": "Approved"},
        {"amount": 5000, "amount_base": 5000.0, "currency": "USD", "status": "Approved"},
    ]
    assert money.claim_total_base(items) == 5060.0


def test_claim_total_excludes_unconverted_rows_rather_than_guessing():
    """An unconverted row contributes 0, not its raw figure. Understating a
    total visibly beats overstating it invisibly; analytics reports the gap
    separately."""
    items = [
        {"amount": 5000, "amount_base": None, "currency": "INR", "status": "Approved"},
        {"amount": 100, "amount_base": 100.0, "currency": "USD", "status": "Approved"},
    ]
    assert money.claim_total_base(items) == 100.0


# ───────────────── paging ─────────────────


def test_fetch_all_rows_keeps_going_past_the_first_page():
    """PostgREST caps a response at 1000 rows and says nothing. One
    .execute() therefore returns a prefix; fetch_all_rows must page until a
    short page proves the end."""
    pages = [
        [{"i": n} for n in range(1000)],
        [{"i": n} for n in range(1000, 1750)],
    ]
    seen_ranges = []

    def _build():
        return _RangeQuery(pages, seen_ranges)

    rows = db_mod.fetch_all_rows(_build, page_size=1000)
    assert len(rows) == 1750
    assert seen_ranges == [(0, 999), (1000, 1999)]


def test_fetch_all_rows_stops_on_a_short_page():
    """A page shorter than page_size is the end; no further request."""
    calls = []

    def _build():
        return _RangeQuery([[{"i": 1}, {"i": 2}]], calls)

    rows = db_mod.fetch_all_rows(_build, page_size=1000)
    assert len(rows) == 2
    assert len(calls) == 1


def test_fetch_all_rows_respects_its_ceiling():
    """An unbounded loop against a huge table is its own failure mode."""
    full = [[{"i": n} for n in range(10)] for _ in range(100)]

    def _build():
        return _RangeQuery(full, [])

    rows = db_mod.fetch_all_rows(_build, page_size=10, max_rows=30)
    assert len(rows) == 30


# ───────────────── bounded cache ─────────────────


def test_ttl_cache_expires():
    cache = config.TTLCache(ttl_seconds=0.05)
    cache.set("k", "v")
    assert cache.get("k") == "v"
    time.sleep(0.08)
    assert cache.get("k") is None


def test_ttl_cache_is_bounded():
    """The policy cache used to be a bare dict: one permanent entry per
    company_id, never evicted."""
    cache = config.TTLCache(ttl_seconds=60, max_entries=3)
    for i in range(10):
        cache.set(f"k{i}", i)
    assert len(cache._data) <= 3


# ───────────────── failing loudly ─────────────────


def test_unreadable_policy_is_a_503_not_a_silent_default(monkeypatch):
    """The AUD-14 headline.

    get_policy_record used to be `except: pass`, so a database blip returned
    None, get_policy fell through to "Standard business expense rules apply."
    and the expense was audited against nothing — with the verdict returned
    as though it were real.
    """
    monkeypatch.setattr(policy, "_policy_cache", config.TTLCache(60))

    def _boom(company_id):
        raise policy.PolicyUnavailable("connection reset")

    monkeypatch.setattr(policy, "get_policy_record", _boom)

    with pytest.raises(HTTPException) as exc:
        policy.get_policy("acme")
    assert exc.value.status_code == 503
    assert "could not be read" in exc.value.detail.lower()


def test_absent_policy_still_falls_back_to_defaults(monkeypatch):
    """A company that has genuinely not uploaded a policy is a real state,
    not a fault — it must not 503."""
    monkeypatch.setattr(policy, "_policy_cache", config.TTLCache(60))
    monkeypatch.setattr(policy, "get_policy_record", lambda company_id: None)

    assert policy.get_policy("acme") == policy.DEFAULT_POLICY_TEXT


def test_missing_column_is_reported_not_silently_dropped(monkeypatch):
    """insert_row replaced three functions that stripped whichever column
    Postgres complained about and inserted the row anyway — so an expense
    could lose its policy_snippet and still return success."""
    class _Table:
        def insert(self, payload):
            return self

        def execute(self):
            raise RuntimeError("Could not find the 'policy_snippet' column")

    monkeypatch.setattr(
        db_mod, "db", lambda: type("DB", (), {"table": lambda s, n: _Table()})())

    with pytest.raises(HTTPException) as exc:
        db_mod.insert_row("expenses", {"id": "x", "policy_snippet": "s"}, "Expense")
    assert exc.value.status_code == 500
    assert "policy_snippet" in exc.value.detail
    assert "001_init.sql" in exc.value.detail


# ───────────────── helpers ─────────────────


class _RangeQuery:
    """Minimal PostgREST-shaped builder that serves canned pages."""

    def __init__(self, pages, seen):
        self._pages = pages
        self._seen = seen
        self._index = 0

    def range(self, start, end):
        self._seen.append((start, end))
        self._index = start // (end - start + 1)
        return self

    def execute(self):
        data = self._pages[self._index] if self._index < len(self._pages) else []
        return type("R", (), {"data": data})()


def _fx_db(rows):
    """A db() stand-in whose fx_rates query returns `rows`."""
    class _Q:
        def select(self, *a, **k): return self
        def eq(self, *a, **k): return self
        def lte(self, *a, **k): return self
        def order(self, *a, **k): return self
        def limit(self, *a, **k): return self
        def execute(self): return type("R", (), {"data": rows})()

    class _DB:
        def table(self, name): return _Q()

    return _DB
