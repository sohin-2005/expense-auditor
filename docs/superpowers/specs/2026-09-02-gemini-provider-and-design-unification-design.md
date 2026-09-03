# Gemini Provider Layer + Design Unification

**Date:** 2026-09-02
**Status:** Approved, pending implementation

## Problem

Two independent problems, bundled here because they were requested together but
implemented as separate phases.

### 1. Receipt scanning is broken

Groq deprecated the models this app hardcodes. Verified against the live account:

| Model | Used for | Status on account |
|---|---|---|
| `meta-llama/llama-4-scout-17b-16e-instruct` | image OCR | 404 `model_not_found` |
| `llama-3.1-8b-instant` | PDF text + policy audit | 404 `model_not_found` |

The text model was already swapped to `qwen/qwen3.8-27b` as a stopgap, and the
PDF path now works end-to-end. **Image receipts still fail with a 500**, because
the Groq account has no vision-capable model at all — verified by enumerating
`/v1/models`, which returns only text, audio, and guard models.

Two secondary defects make this worse:

- `extract_receipt` wraps everything in `except Exception` and re-raises as a
  generic `500 Receipt processing failed`. A provider outage, an unreadable
  receipt, and a database error are indistinguishable to the caller.
- Model names are hardcoded at six separate call sites, so a provider change
  means editing six places.

### 2. The UI is two half-finished design systems

`frontend/src/App.jsx` is 3,446 lines with 631 inline `style={{...}}` objects and
no CSS system. It themes itself two contradictory ways at once:

- 457 references to a dark `THEME` constant
- 238 hardcoded light-mode hex values (`#111827`, `#6b7280`, `#e5e7eb`, …)

The visible result: a dark sidebar and dashboard with blinding white modals on
top. This is the main reason the app reads as unfinished.

## Goals

- Image receipts work.
- An LLM provider outage degrades gracefully instead of returning opaque 500s.
- Swapping providers or models is a config change, not a code change.
- The UI commits to one coherent, professional visual language.

## Non-goals

- Restructuring `App.jsx` into multiple files (explicitly deferred).
- Adding a third AI provider now.
- Changing any product flow, data model, or database schema.

---

## Phase 1 — AI provider layer

### Configuration

New environment variables in `backend/.env` (values set by the operator):

```
GEMINI_API_KEY=              # set by operator
GEMINI_TEXT_MODEL=gemini-2.0-flash
GEMINI_VISION_MODEL=gemini-2.0-flash
AI_PRIMARY_PROVIDER=gemini
```

Existing `GROQ_API_KEY` is retained and becomes the fallback provider. Model
names move entirely into configuration; no model string remains in application
code.

The model defaults above are starting values, not verified facts. Provider
catalogs drift — that is precisely what caused this outage, when two hardcoded
Groq models silently disappeared from the account. Before implementation, the
available model list is enumerated from the provider API with the live key, and
the defaults are set to models confirmed present. A startup check logs a loud
warning when a configured model is not in the provider's catalog, so the next
deprecation surfaces at boot instead of as a 500 during a user's upload.

### Interface

`call_groq_json(messages, model, max_tokens, temperature, retries)` is replaced
by:

```python
call_ai_json(messages, task, max_tokens, temperature=0)
    # task: "text" | "vision"
```

Callers state *what kind of work* they need, not which model runs it. The layer
resolves provider and model from configuration. All six existing call sites are
updated:

| Line (pre-change) | Purpose | Task |
|---|---|---|
| 923 | trip planning | `text` |
| 1100 | PDF receipt extraction | `text` |
| 1112 | image receipt OCR | `vision` |
| 1156 | policy audit (receipt) | `text` |
| 1375 | policy audit (expense) | `text` |
| 1663 | policy Q&A assistant | `text` |

### Transport

Google exposes an OpenAI-compatible endpoint for Gemini. Using it lets the
existing message format — including the `image_url` data-URI parts the vision
path already constructs — pass through unchanged, so the six call sites keep
their current shape.

This assumption is verified as the first implementation step, against a live
key, for both a text and a vision call. If compatibility proves insufficient
(for example, on JSON-mode behavior or image part handling), the fallback is the
native `google-genai` SDK behind the same `call_ai_json` signature. The
interface is chosen so this substitution touches one function.

`openai` is added to `backend/requirements.txt`, pinned, consistent with the
file's existing pinning policy.

### Fallback semantics

| Task | Primary | Fallback | If all fail |
|---|---|---|---|
| `text` | Gemini | Groq (`qwen/qwen3.8-27b`) | `AIUnavailableError` |
| `vision` | Gemini | *none possible* | `AIUnavailableError` |

Vision has no fallback because the Groq account has no vision model. This is a
deliberate, documented asymmetry rather than an oversight.

Retry and timeout behavior carries over from `call_groq_json`: a per-attempt
timeout, bounded retries, short backoff between attempts. Each call logs which
provider served it and whether a fallback was used, so provider drift is visible
in logs rather than discovered through user reports.

### Error handling

The generic `except Exception -> 500` is replaced with typed outcomes:

| Condition | Status | User-facing message |
|---|---|---|
| All providers failed, image receipt | 503 | "Image scanning is temporarily unavailable — try again shortly, or upload a PDF receipt." |
| All providers failed, text receipt | 503 | "Receipt processing is temporarily unavailable — please try again shortly." |
| PDF has no extractable text | 400 | existing message, retained |
| Amount not parseable | 400 | existing message, retained |
| Database/constraint failure | 500 | generic, but logged with detail server-side |

The policy-audit call keeps its existing behavior of degrading to a "Flagged /
manual review" result rather than failing the whole request — extraction
succeeding while audit fails should still save the expense.

### Testing

- Direct verification of `call_ai_json` for both tasks against the live key.
- End-to-end exercise of `extract_receipt` for a PDF receipt and an image
  receipt using a real account id, asserting extraction values and a successful
  database insert. (This harness already exists from debugging and correctly
  identified the image-path failure.)
- Forced-failure test: with `GEMINI_API_KEY` invalid, confirm text tasks fall
  back to Groq and succeed, and that vision returns 503 with the specified
  message rather than a 500.

---

## Phase 2 — Design unification

### Direction

Light UI, in line with enterprise finance tools (Expensify, Ramp, Brex, Concur):
easier to read dense expense tables, cleaner exports, and it reads as
trustworthy in this product category. The brand green `#76b900` is demoted to an
accent — primary buttons, active navigation, positive status — rather than a
surface color.

The landing/auth page stays dark. That contrast is an intentional brand moment,
not a clash.

### Tokens

A single token set replaces both existing systems. Defined once as CSS custom
properties and mirrored by the existing `THEME` object so current call sites keep
working during migration:

- **Surfaces:** page canvas, card, raised card, hover, border, divider
- **Text:** primary, secondary, muted, inverse
- **Accent:** green (brand), blue (informational), amber (warning), red (danger),
  each with a tinted background variant for badges
- **Scales:** spacing, radius, shadow, font size, font weight, line height

The 238 hardcoded hex values are mapped onto tokens and removed. No raw hex
values remain in component code.

### Scope of the polish pass

Screens: Auth, Sidebar, Dashboard, Claims list, Claim detail, Scan Receipt,
Add Expense, Available Expenses, Trip Planner, Spend Analytics, Notifications,
Company Policy.

Per screen: consistent card treatment, table density and alignment, button
hierarchy (primary/secondary/ghost), status badges (Approved / Flagged /
Rejected), form inputs with real focus and error states, and proper empty,
loading, and error states.

Error states deserve specific attention: several handlers currently swallow
failures into `console.error` with no user-visible feedback, which is a
significant part of why the app feels broken. Every user-initiated action that
can fail must show its failure.

### Structure

`App.jsx` remains a single file, per the approved scope. Styles move out of
inline objects into shared style helpers or CSS classes only where that removes
real duplication — not as a wholesale refactor.

### Testing

- Automated pass over every screen with a headless browser, checking for
  regressions and for any surviving light-on-light or dark-on-dark contrast
  failures.
- Before/after screenshots of each screen.
- Both receipt paths re-verified after the frontend changes, to confirm no
  behavioral regression.

---

## Sequencing

Phase 1 ships and is verified before Phase 2 begins. Phase 1 unbreaks image
receipts; Phase 2 is cosmetic and carries a much larger change surface.

## Related work completed out-of-band

While debugging, three issues were found and addressed or escalated:

1. **Fixed:** stopgap swap of the audit model to `qwen/qwen3.8-27b` plus a token
   budget increase, which unbroke PDF receipts.
2. **Fixed:** `supabase.auth.getSession()` had no `.catch()`, so a rejected
   session restore left the app on its loading screen permanently. Added a
   catch that always clears loading state.
3. **Escalated:** the Supabase `service_role` key was committed to a public
   GitHub repository and was still the key in active use. History has been
   purged and verified in a separate clone; key rotation is the operator's
   responsibility and is the actual remediation.
