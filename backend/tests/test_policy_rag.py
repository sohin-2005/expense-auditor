"""Locks on the Phase 03 retrieval pipeline.

The failure this replaces was silent: get_policy_context() scored paragraphs
by counting how many query words appeared as substrings, so "cab" never
matched a policy written around "taxi", "in" matched "dining", and a chunk
mentioning a word four times scored the same as one mentioning it once. The
audit then ran on whatever that returned, with no way to tell afterwards
which policy passage a verdict actually rested on.

The tests below concentrate on the two properties that make the replacement
worth having: chunks keep a rule together with the exception that voids it,
and a verdict cannot be recorded on a citation that was never retrieved.
"""

import pytest

import policy_rag


POLICY = """1. Travel Policy

This policy governs business travel for all employees.

2. Ground Transport

2.1 Taxis and ride-hailing

Employees may claim taxi, cab and ride-hailing fares for journeys between
airports, hotels and client sites. Receipts are required above 25 USD.

2.2 Rental cars

Rental cars require prior manager approval.

3. Lodging

3.1 Domestic

Lodging is capped at 200 USD per night, unless the employee is travelling
with a client, in which case the cap is 350 USD per night.
"""


# ───────────────── chunking ─────────────────


def test_chunks_carry_their_heading_trail():
    """Provenance has to be legible to a person. A row id means nothing in an
    approval screen; "3 Lodging > 3.1 Domestic" does."""
    chunks = policy_rag.chunk_policy(POLICY)
    paths = [c.section_path for c in chunks if c.section_path]

    assert any("Lodging" in p and "Domestic" in p for p in paths), paths
    # Nesting is by heading depth, so a subsection names its parent.
    lodging = next(p for p in paths if "Domestic" in p)
    assert lodging.startswith("3 Lodging")


def test_a_rule_and_its_exception_stay_in_one_chunk():
    """The single most important chunking property.

    Retrieving "lodging is capped at 200" without "unless travelling with a
    client" produces a confident, wrong rejection -- and it looks entirely
    reasonable in the audit log.
    """
    chunks = policy_rag.chunk_policy(POLICY)
    holding_cap = [c for c in chunks if "200 USD" in c.content]

    assert holding_cap, "the lodging cap was not chunked at all"
    for chunk in holding_cap:
        assert "unless" in chunk.content and "350" in chunk.content


def test_chunk_indexes_are_contiguous():
    """chunk_index is part of the unique key in policy_chunks; gaps or
    duplicates would collide on insert."""
    chunks = policy_rag.chunk_policy(POLICY)
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))


def test_empty_policy_produces_no_chunks():
    assert policy_rag.chunk_policy("") == []
    assert policy_rag.chunk_policy("   \n\n  ") == []


def test_unstructured_policy_still_chunks():
    """Not every policy is numbered. One with no headings must still be
    retrievable, just without a section path."""
    text = "Employees may claim reasonable expenses. " * 200
    chunks = policy_rag.chunk_policy(text)

    assert len(chunks) > 1
    assert all(c.content.strip() for c in chunks)


def test_long_sections_are_split_with_overlap():
    """Overlap is what stops a split landing between a limit and its
    qualifier."""
    body = "\n\n".join(f"Paragraph {i} about meal allowances and limits." * 12
                       for i in range(40))
    chunks = policy_rag.chunk_policy(f"4. Meals\n\n{body}")

    assert len(chunks) > 1
    assert all(len(c.content) <= policy_rag.TARGET_CHUNK_CHARS * 2
               for c in chunks)


def test_a_numbered_sentence_is_not_mistaken_for_a_heading():
    """"2. Employees must retain receipts for..." is prose, not a section."""
    text = ("1. Introduction\n\n"
            "2. Employees must retain receipts for every expense they intend "
            "to claim, including meals, and submit them within thirty days of "
            "the transaction date, otherwise the claim is refused.\n")
    chunks = policy_rag.chunk_policy(text)
    paths = [c.section_path or "" for c in chunks]
    assert not any("Employees must retain" in p for p in paths)


# ───────────────── query construction ─────────────────


def test_query_uses_the_whole_expense_not_just_the_category():
    """An airport lounge charge is found by "lounge", never by "meals"."""
    query = policy_rag.build_retrieval_query({
        "type": "meals",
        "vendor": "Heathrow Aspire Lounge",
        "city": "London",
        "business_purpose": "client meeting",
        "amount": 48,
        "currency": "GBP",
    })

    lowered = query.lower()
    for term in ("meals", "lounge", "london", "client meeting", "48"):
        assert term in lowered, f"{term!r} missing from {query!r}"


def test_query_deduplicates_repeated_fields():
    """vendor and vendor_name usually hold the same string; sending it twice
    just crowds out other terms."""
    query = policy_rag.build_retrieval_query(
        {"vendor": "Uber", "vendor_name": "uber", "merchant_name": "UBER"})
    assert query.lower().count("uber") == 1


def test_empty_payload_yields_an_empty_query():
    """An empty query must not run a search -- retrieve_policy_chunks bails
    on this rather than returning arbitrary chunks."""
    assert policy_rag.build_retrieval_query({}) == ""


# ───────────────── citations ─────────────────


RETRIEVED = [
    {"id": 41, "section_path": "3 Lodging > 3.1 Domestic", "content": "capped at 200 USD"},
    {"id": 47, "section_path": "2 Ground Transport", "content": "taxi fares are claimable"},
]


def test_citation_of_a_retrieved_chunk_resolves():
    assert policy_rag.verify_citation(47, RETRIEVED)["id"] == 47
    # Models return JSON, and JSON numbers arrive as strings often enough.
    assert policy_rag.verify_citation("47", RETRIEVED)["id"] == 47


@pytest.mark.parametrize("cited", [99, None, "", "chunk 47", [], {"id": 47}])
def test_uncited_or_invented_ids_do_not_resolve(cited):
    """The whole point. An id that was not in the retrieved set means the
    verdict rests on nothing -- which is the signature of a hallucination and
    of a successful prompt injection alike."""
    assert policy_rag.verify_citation(cited, RETRIEVED) is None


def test_prompt_format_exposes_the_ids_the_model_must_cite():
    rendered = policy_rag.format_chunks_for_prompt(RETRIEVED)
    assert "[chunk 41]" in rendered
    assert "[chunk 47]" in rendered
    # The section path rides along so the model can quote it back and a human
    # can recognize it.
    assert "3 Lodging > 3.1 Domestic" in rendered
    assert "capped at 200 USD" in rendered
