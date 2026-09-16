"""Policy retrieval: chunk, embed, search, cite.

Replaces get_policy_context()'s keyword trimmer (see db/005_policy_chunks.sql
for what was wrong with it). The pipeline is:

    upload  ->  chunk on headings  ->  embed in batches  ->  policy_chunks
    audit   ->  build a query from the expense  ->  hybrid search  ->  prompt
    verdict ->  model cites a chunk id  ->  server verifies it was retrieved

The last step is the one that earns the migration. Today's `policy_snippet`
is free text the model produced, which means it can be fluent, confident and
entirely invented. A verified chunk id is a reference into a real document at
a known version -- and injected text inside a receipt cannot manufacture an id
that was actually retrieved.

This module deliberately holds no FastAPI or Supabase imports beyond the
client handle passed in, so Phase 04 can move it to services/retrieval.py
without untangling it from the route layer.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import ai_provider

logger = logging.getLogger(__name__)

# ~4 characters per token is the usual English approximation. Chunk sizes are
# expressed in characters throughout so nothing depends on a tokenizer that
# would have to match the provider's.
CHARS_PER_TOKEN = 4
TARGET_CHUNK_TOKENS = 500
OVERLAP_TOKENS = 60

TARGET_CHUNK_CHARS = TARGET_CHUNK_TOKENS * CHARS_PER_TOKEN
OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN
MIN_CHUNK_CHARS = 80

EMBED_BATCH_SIZE = 64

# How many chunks reach the prompt, and how many candidates the fusion sees.
# Retrieving well past what you send and then truncating is what makes the
# fusion worth doing: a chunk ranked 15th by vectors and 3rd by keywords is
# exactly the one a single ranking would have dropped.
MATCH_COUNT = 8
CANDIDATE_COUNT = 24

# Numbered headings: "4.", "4.2", "4.2.1", "Section 4.2", "Appendix B".
# Expense policies are numbered documents, and the numbering is the structure
# a reader navigates by -- so it is also the structure a citation should name.
_HEADING_RE = re.compile(
    r"^\s*(?:(?:section|clause|appendix|annex|part)\s+)?"
    r"((?:\d+(?:\.\d+)*)|(?:[A-Z]))"
    r"[.)]?\s+(\S.{0,110})$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Chunk:
    section_path: str | None
    chunk_index: int
    content: str

    @property
    def token_estimate(self) -> int:
        return max(1, len(self.content) // CHARS_PER_TOKEN)


def _heading_of(line: str) -> tuple[str, str] | None:
    """(number, title) when a line looks like a numbered heading."""
    if len(line) > 140:
        return None
    m = _HEADING_RE.match(line.rstrip())
    if not m:
        return None
    number, title = m.group(1), m.group(2).strip()
    # A sentence that merely starts with a number is not a heading.
    if title.endswith((".", ";", ",")) and len(title.split()) > 12:
        return None
    return number, title


def _split_oversized(text: str) -> list[str]:
    """Break a long section on paragraph boundaries, with overlap.

    Overlap exists for one reason: a limit and the exception that voids it
    must not land in different chunks. Retrieval returning "lodging is capped
    at 200" without "unless travelling with a client" produces a confident
    wrong verdict.
    """
    if len(text) <= TARGET_CHUNK_CHARS:
        return [text]

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n+", text) if p.strip()]
    if not paragraphs:
        paragraphs = [text]

    out: list[str] = []
    current = ""
    for para in paragraphs:
        candidate = f"{current}\n\n{para}" if current else para
        if len(candidate) <= TARGET_CHUNK_CHARS or not current:
            current = candidate
            continue
        out.append(current)
        tail = current[-OVERLAP_CHARS:] if OVERLAP_CHARS else ""
        current = f"{tail}\n\n{para}" if tail else para

    if current:
        out.append(current)

    # A single paragraph longer than the target still has to be cut somewhere;
    # do it on character count rather than dropping it.
    final: list[str] = []
    for piece in out:
        while len(piece) > TARGET_CHUNK_CHARS * 2:
            final.append(piece[:TARGET_CHUNK_CHARS])
            piece = piece[TARGET_CHUNK_CHARS - OVERLAP_CHARS:]
        final.append(piece)
    return final


def chunk_policy(policy_text: str) -> list[Chunk]:
    """Split a policy into retrievable chunks along its own headings.

    Heading-aware rather than blank-line-delimited, which is what the old
    trimmer used: a rule and its sub-clauses belong together, and the heading
    trail is what makes a citation legible to a person ("5.2 Lodging >
    Domestic") instead of an opaque row id.
    """
    text = str(policy_text or "").strip()
    if not text:
        return []

    sections: list[tuple[str | None, list[str]]] = []
    trail: list[tuple[str, str]] = []
    current_path: str | None = None
    body: list[str] = []

    for line in text.splitlines():
        heading = _heading_of(line)
        if heading is None:
            body.append(line)
            continue

        if body and any(b.strip() for b in body):
            sections.append((current_path, body))
        body = []

        number, title = heading
        depth = number.count(".")
        trail = [t for t in trail if t[0].count(".") < depth]
        trail.append((number, title))
        current_path = " > ".join(f"{n} {t}" for n, t in trail)
        # Keep the heading itself in the chunk: it is often where the scope of
        # the rule is stated ("4.2 International travel").
        body.append(line)

    if body and any(b.strip() for b in body):
        sections.append((current_path, body))

    if not sections:
        sections = [(None, text.splitlines())]

    chunks: list[Chunk] = []
    index = 0
    for path, lines in sections:
        section_text = "\n".join(lines).strip()
        if len(section_text) < MIN_CHUNK_CHARS:
            # Too small to retrieve on its own; fold it into the previous
            # chunk rather than creating a fragment nothing will ever match.
            if chunks:
                merged = f"{chunks[-1].content}\n\n{section_text}"
                chunks[-1] = Chunk(chunks[-1].section_path,
                                   chunks[-1].chunk_index, merged)
                continue
            if not section_text:
                continue
        for piece in _split_oversized(section_text):
            piece = piece.strip()
            if not piece:
                continue
            chunks.append(Chunk(path, index, piece))
            index += 1
    return chunks


def build_retrieval_query(payload: dict) -> str:
    """Compose the text a policy search runs against.

    Built from the whole expense, not just its category: vendor, city and
    purpose all pick out rules that a bare category misses -- an airport
    lounge charge is retrieved by "lounge", never by "meals".
    """
    parts: list[str] = []
    for key in ("type", "expense_type", "category", "vendor", "vendor_name",
                "merchant_name", "city", "destination", "business_purpose",
                "payment_type"):
        value = payload.get(key)
        if isinstance(value, (list, tuple)):
            parts.extend(str(v) for v in value if v)
        elif value:
            parts.append(str(value))

    amount = payload.get("amount")
    currency = payload.get("currency")
    if amount is not None:
        # The amount matters to retrieval because policies are written in
        # bands ("above 500 requires approval"); the literal number is what
        # the keyword half of the search can match on.
        parts.append(f"{currency or ''} {amount}".strip())

    seen: set[str] = set()
    unique: list[str] = []
    for part in parts:
        norm = part.strip().lower()
        if norm and norm not in seen:
            seen.add(norm)
            unique.append(part.strip())
    return " ".join(unique)[:900]


async def embed_chunks(chunks: list[Chunk]) -> list[list[float] | None]:
    """Embed every chunk, in batches. None entries are tolerated."""
    vectors: list[list[float] | None] = []
    for start in range(0, len(chunks), EMBED_BATCH_SIZE):
        batch = chunks[start:start + EMBED_BATCH_SIZE]
        vectors.extend(await ai_provider.embed_texts([c.content for c in batch]))
    return vectors


def format_chunks_for_prompt(rows: list[dict]) -> str:
    """Render retrieved chunks with the ids the model must cite."""
    blocks = []
    for row in rows:
        header = f"[chunk {row['id']}]"
        path = row.get("section_path")
        if path:
            header += f" {path}"
        blocks.append(f"{header}\n{row.get('content') or ''}".strip())
    return "\n\n".join(blocks)


def verify_citation(cited_id, rows: list[dict]) -> dict | None:
    """Return the retrieved chunk the verdict cites, or None.

    None means the model named something that was not in front of it. The
    caller must not store that verdict as a decision: an unsupported citation
    is the signature of both a hallucination and a successful prompt
    injection, and neither should be recorded as an approval.
    """
    if cited_id is None:
        return None
    try:
        wanted = int(cited_id)
    except (TypeError, ValueError):
        return None
    for row in rows:
        if int(row.get("id", -1)) == wanted:
            return row
    return None
