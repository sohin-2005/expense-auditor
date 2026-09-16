"""Hashing and verification for security answers.

A security answer is a credential. It unlocks a password reset, which unlocks
the account, so it gets the same treatment a password would: PBKDF2-SHA256, a
random per-answer salt, and a constant-time comparison. Storing it in plain
text is how "your mother's maiden name" ends up in a breach dump and then in
somebody else's password-reset form.

No new dependency -- hashlib and secrets are standard library.
"""
import hashlib
import hmac
import logging
import re
import secrets

logger = logging.getLogger(__name__)

# 210,000 is OWASP's 2023 floor for PBKDF2-HMAC-SHA256. A reset is rare and
# interactive, so the ~100ms this costs is invisible to the person doing it
# and expensive for anyone working through a leaked table.
ITERATIONS = 210_000
SALT_BYTES = 16
ALGORITHM = "pbkdf2_sha256"

MIN_ANSWER_LENGTH = 3
MAX_ANSWER_LENGTH = 200

# Offered at registration. Deliberately short and concrete: a long list
# invites someone to pick the one they will not remember, and questions with
# public answers ("what city were you born in") are worse than useless.
SECURITY_QUESTIONS = [
    "What was the name of your first pet?",
    "What was the first company you worked for?",
    "What is the name of the street you grew up on?",
    "What was the make of your first car or bike?",
    "What is a nickname only your family uses for you?",
    "What was the title of the first film you saw in a cinema?",
]


def normalize_answer(answer: str) -> str:
    """Fold the differences a person will not remember making.

    Case and surrounding whitespace are dropped, and internal runs of
    whitespace collapse to one. Nothing else: stripping punctuation would
    make "O'Brien" and "OBrien" the same answer, which quietly widens what
    counts as correct.
    """
    return re.sub(r"\s+", " ", str(answer or "").strip()).lower()


def hash_answer(answer: str) -> str:
    """Return 'pbkdf2_sha256$iterations$salt$hash' for storage."""
    normalized = normalize_answer(answer)
    if len(normalized) < MIN_ANSWER_LENGTH:
        raise ValueError(
            f"Security answer must be at least {MIN_ANSWER_LENGTH} characters.")
    salt = secrets.token_hex(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(
        "sha256", normalized.encode("utf-8"), salt.encode("utf-8"), ITERATIONS
    ).hex()
    return f"{ALGORITHM}${ITERATIONS}${salt}${digest}"


def verify_answer(answer: str, stored: str) -> bool:
    """Constant-time check of an answer against a stored hash.

    Returns False rather than raising on a malformed or missing hash: a
    corrupt row must refuse the reset, not crash the endpoint into a 500 that
    tells the caller the row exists.
    """
    if not stored or not answer:
        return False
    try:
        algorithm, iterations, salt, expected = stored.split("$", 3)
        if algorithm != ALGORITHM:
            logger.warning("unknown password hash algorithm %r", algorithm)
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", normalize_answer(answer).encode("utf-8"),
            salt.encode("utf-8"), int(iterations),
        ).hex()
    except (ValueError, TypeError):
        logger.warning("malformed security answer hash", exc_info=True)
        return False
    # compare_digest, not ==, so the comparison takes the same time whether
    # the first character is wrong or the last one is.
    return hmac.compare_digest(digest, expected)


def validate_password(password: str) -> str:
    """Return the password, or raise ValueError with a usable reason.

    Length only. Composition rules ("one uppercase, one symbol") push people
    toward Password1! and are no longer recommended by NIST; length is what
    actually costs an attacker.
    """
    pw = str(password or "")
    if len(pw) < 8:
        raise ValueError("Password must be at least 8 characters.")
    if len(pw) > 128:
        raise ValueError("Password must be 128 characters or fewer.")
    return pw
