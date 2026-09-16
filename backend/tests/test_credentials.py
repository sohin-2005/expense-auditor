"""Locks on credential handling for account recovery.

A security answer unlocks a password reset, which unlocks the account. That
makes it a credential, and these tests exist to keep it treated as one — the
failure mode being a plaintext "mother's maiden name" column that turns a
database leak into an account takeover.
"""
import pytest

from domain.credentials import (MIN_ANSWER_LENGTH, SECURITY_QUESTIONS,
                                hash_answer, normalize_answer,
                                validate_password, verify_answer)


# ───────────────── hashing ─────────────────


def test_answer_is_never_stored_in_plain_text():
    """The single most important property here."""
    stored = hash_answer("Rusty the beagle")
    assert "rusty" not in stored.lower()
    assert "beagle" not in stored.lower()
    assert stored.startswith("pbkdf2_sha256$")


def test_same_answer_hashes_differently_each_time():
    """A per-answer salt. Without it, two people with the same answer share a
    hash, and one leaked rainbow table cracks both."""
    a, b = hash_answer("blue"), hash_answer("blue")
    assert a != b
    assert verify_answer("blue", a)
    assert verify_answer("blue", b)


def test_correct_answer_verifies():
    assert verify_answer("Rusty", hash_answer("Rusty")) is True


def test_wrong_answer_is_refused():
    assert verify_answer("Fido", hash_answer("Rusty")) is False


@pytest.mark.parametrize("stored", [
    "", None, "garbage", "pbkdf2_sha256$notanumber$salt$hash",
    "md5$1$salt$hash", "pbkdf2_sha256$210000$salt",
])
def test_malformed_hashes_refuse_rather_than_crash(stored):
    """A corrupt row must refuse the reset, not 500. A crash on a specific
    account is itself a signal that the account exists."""
    assert verify_answer("anything", stored) is False


def test_empty_answer_never_verifies():
    assert verify_answer("", hash_answer("Rusty")) is False
    assert verify_answer(None, hash_answer("Rusty")) is False


# ───────────────── normalization ─────────────────


@pytest.mark.parametrize("variant", [
    "Rusty", "rusty", "RUSTY", "  Rusty  ", "rusty ", "\tRusty\n",
])
def test_case_and_surrounding_whitespace_are_forgiven(variant):
    """Nobody remembers whether they capitalised it a year ago."""
    assert verify_answer(variant, hash_answer("rusty")) is True


def test_internal_whitespace_runs_collapse():
    assert verify_answer("New   York", hash_answer("New York")) is True


def test_punctuation_is_significant():
    """Deliberately NOT normalized. Stripping apostrophes would make O'Brien
    and OBrien the same answer, quietly widening what counts as correct."""
    assert verify_answer("OBrien", hash_answer("O'Brien")) is False


def test_normalize_is_idempotent():
    once = normalize_answer("  Mixed   Case  ")
    assert normalize_answer(once) == once


def test_too_short_an_answer_is_rejected_at_hash_time():
    """Refused when set, not when used — telling someone their saved answer
    was never usable at reset time is the worst possible moment."""
    with pytest.raises(ValueError):
        hash_answer("a" * (MIN_ANSWER_LENGTH - 1))


# ───────────────── questions ─────────────────


def test_offered_questions_have_no_publicly_discoverable_answers():
    """Birth city, school and mother's maiden name are all findable. The list
    is short on purpose; this test is what keeps it that way."""
    banned = ("born", "birth", "maiden", "school", "mother")
    for question in SECURITY_QUESTIONS:
        lowered = question.lower()
        for word in banned:
            assert word not in lowered, f"{question!r} contains {word!r}"


def test_questions_are_unique():
    assert len(SECURITY_QUESTIONS) == len(set(SECURITY_QUESTIONS))


# ───────────────── passwords ─────────────────


@pytest.mark.parametrize("password", ["", "short", "1234567"])
def test_short_passwords_are_rejected(password):
    with pytest.raises(ValueError):
        validate_password(password)


def test_long_passwords_are_rejected():
    """A megabyte password is a denial-of-service against the hash function,
    not a security improvement."""
    with pytest.raises(ValueError):
        validate_password("x" * 129)


@pytest.mark.parametrize("password", [
    "correct horse battery staple", "8charsss", "a" * 128,
])
def test_length_is_the_only_rule(password):
    """No composition requirements. NIST dropped them because they push people
    to Password1! — length is what actually costs an attacker."""
    assert validate_password(password) == password
