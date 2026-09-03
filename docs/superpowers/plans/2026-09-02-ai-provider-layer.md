# AI Provider Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded Groq model calls with a task-based provider layer using Gemini as primary and Groq as fallback, so image receipts work and provider outages degrade gracefully instead of returning opaque 500s.

**Architecture:** A new `backend/ai_provider.py` owns all LLM concerns. Callers ask for a *task* (`"text"` or `"vision"`), never a model name. Both Gemini and Groq expose OpenAI-compatible chat completion endpoints, so one client class serves both — only `base_url`, key, and model differ. Text tasks try Gemini then fall back to Groq; vision tasks are Gemini-only and raise a typed error when unavailable.

**Tech Stack:** Python 3.13, FastAPI, `openai` SDK (as an OpenAI-compatible client for both providers), pytest.

**Spec:** `docs/superpowers/specs/2026-09-02-gemini-provider-and-design-unification-design.md`

## Global Constraints

- Environment variables, exact names: `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_VISION_MODEL`, `AI_PRIMARY_PROVIDER`, `GROQ_API_KEY`.
- Model names must never appear in application code — only in configuration defaults inside `ai_provider.py`.
- `backend/requirements.txt` pins exact versions (`==`), per the policy documented at the top of that file.
- Vision has no fallback provider. This asymmetry is deliberate: the Groq account has no vision-capable model.
- The policy-audit call must keep degrading to a "Flagged / manual review" result rather than failing the whole request.
- Never commit `backend/.env`. It is gitignored.
- Tests must not make live network calls. Live verification happens only in Task 1 and Task 8, which are explicitly manual.

---

### Task 1: Verify the Gemini API surface — ✅ COMPLETE (2026-09-02)

**Results, measured against the live key:**

| Check | Outcome |
|---|---|
| Catalog readable | Yes, 53 models |
| `gemini-2.0-flash` (original spec default) | **Does not exist** |
| `gemini-2.5-flash` | Retired — "no longer available to new users" |
| `gemini-3.7-flash`, `gemini-flash-latest` | **Hang indefinitely**, 4/4 timeouts at 40s |
| `gemini-3.6-flash` | Works, text 3.4-4.8s |
| **`gemini-3.5-flash`** | **Chosen** — text ~1.7s, vision ~10s, consistent |
| OpenAI-compat JSON mode | Works |
| OpenAI-compat vision, our exact `image_url` data-URI shape | **Works — no call-site rewrite needed** |
| `openai` SDK 3.7.0 against Gemini | Works for text and vision |
| Hidden reasoning tokens | **670-840 per call, charged against `max_tokens`** |
| `reasoning_effort: "none"` / `"low"` | 400 error / no reduction — thinking cannot be disabled |

The reasoning-token finding is the consequential one: at the existing budgets
(170-420) every call returns `finish_reason: length` with truncated JSON. Task 6
Step 0 raises them. The native `google-genai` fallback is **not** needed.

The steps below are retained as the record of how this was verified.

This task is a gate, not a code change. It replaces two assumptions — that
`gemini-2.0-flash` exists, and that the OpenAI-compatible endpoint accepts our
existing message format — with facts. Hardcoding an unverified model name is the
exact bug that broke this app.

**Requires:** `GEMINI_API_KEY` set in `backend/.env`.

**Files:**
- Create: `/tmp/verify_gemini.py` (throwaway, not committed)

**Interfaces:**
- Consumes: nothing
- Produces: confirmed model IDs for `GEMINI_TEXT_MODEL` and `GEMINI_VISION_MODEL` defaults used by Task 2; a yes/no on OpenAI-compat viability.

- [ ] **Step 1: Install the OpenAI SDK into the venv**

```bash
cd backend && venv/bin/pip install openai
```

- [ ] **Step 2: Enumerate the models the key can actually reach**

```python
# /tmp/verify_gemini.py
import os, json
from openai import OpenAI

key = None
for line in open("backend/.env"):
    if line.startswith("GEMINI_API_KEY="):
        key = line.strip().split("=", 1)[1]

client = OpenAI(api_key=key,
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/")

print("=== models ===")
for m in client.models.list():
    print(m.id)
```

Run: `cd backend && venv/bin/python3 /tmp/verify_gemini.py`
Expected: a list of model IDs. Record the newest flash-tier text model and a
vision-capable model. Do not assume `gemini-2.0-flash` is present.

- [ ] **Step 3: Verify a JSON-mode text completion**

Append to `/tmp/verify_gemini.py` and re-run, substituting the model ID recorded
in Step 2:

```python
print("=== text + json_object ===")
r = client.chat.completions.create(
    model="<MODEL_ID_FROM_STEP_2>",
    messages=[{"role": "user", "content":
               "Respond with a valid JSON object only. One field: greeting, value hi."}],
    response_format={"type": "json_object"},
    max_tokens=300,
    temperature=0,
)
print(r.choices[0].message.content)
print("completion_tokens:", r.usage.completion_tokens)
```

Expected: valid JSON, e.g. `{"greeting": "hi"}`. Record `completion_tokens` — if
this provider is markedly more verbose than Groq's qwen (231 tokens for a full
receipt), the token budgets in Task 6 need raising.

- [ ] **Step 4: Verify a vision completion in our exact message shape**

This is the critical check: our image path builds OpenAI-style `image_url` parts
with a data URI. Confirm Gemini's compat layer accepts that shape verbatim.

```python
import base64
print("=== vision (data URI image_url part) ===")
img = base64.b64encode(open("/tmp/receipt.pdf", "rb").read())  # replace with a real JPG
jpg_b64 = base64.b64encode(open("<PATH_TO_A_REAL_RECEIPT>.jpg", "rb").read()).decode()
r = client.chat.completions.create(
    model="<VISION_MODEL_ID_FROM_STEP_2>",
    messages=[{"role": "user", "content": [
        {"type": "text", "text": "Extract merchant_name and total_amount as JSON."},
        {"type": "image_url",
         "image_url": {"url": f"data:image/jpeg;base64,{jpg_b64}"}},
    ]}],
    response_format={"type": "json_object"},
    max_tokens=400,
    temperature=0,
)
print(r.choices[0].message.content)
```

Expected: JSON naming the merchant and amount from the receipt image.

- [ ] **Step 5: Record the decision**

If Steps 3 and 4 both pass, the OpenAI-compat transport is confirmed; proceed to
Task 2 using the recorded model IDs as defaults.

If Step 4 fails on the `image_url` shape, stop and report. The fallback is the
native `google-genai` SDK behind the same `call_ai_json` signature — the
interface in Task 4 is unchanged, only `OpenAICompatProvider` is joined by a
`GeminiNativeProvider`. Do not improvise a workaround; raise it for a decision.

- [ ] **Step 6: Clean up**

```bash
rm /tmp/verify_gemini.py
```

No commit — this task produces knowledge, not code.

---

### Task 2: Test scaffolding and provider configuration

**Files:**
- Create: `backend/pytest.ini`
- Create: `backend/tests/__init__.py` (empty)
- Create: `backend/tests/test_ai_provider.py`
- Create: `backend/ai_provider.py`
- Modify: `backend/requirements.txt`

**Interfaces:**
- Consumes: model IDs confirmed in Task 1.
- Produces: `ProviderSpec(name, api_key, base_url, model, supports_vision)`,
  `AIConfig(text_chain, vision_chain, timeout_seconds, retries)`,
  `load_config(env: Mapping[str, str]) -> AIConfig`,
  and the constants `TEXT = "text"`, `VISION = "vision"`.

- [ ] **Step 1: Add dependencies**

Add to `backend/requirements.txt`, keeping the existing `==` pinning policy.
Use the versions `pip` actually resolves; do not guess.

```bash
cd backend && venv/bin/pip install openai pytest
venv/bin/pip show openai pytest | grep -E "^Name|^Version"
```

Then append the resolved pins to `backend/requirements.txt`:

```
openai==<resolved version>
pytest==<resolved version>
```

- [ ] **Step 2: Create the pytest config**

```ini
# backend/pytest.ini
[pytest]
testpaths = tests
python_files = test_*.py
addopts = -q
```

- [ ] **Step 3: Write the failing tests for config loading**

```python
# backend/tests/test_ai_provider.py
import pytest
import ai_provider
from ai_provider import load_config, TEXT, VISION


def test_text_chain_is_gemini_then_groq_when_both_keys_present():
    cfg = load_config({
        "GEMINI_API_KEY": "g-key",
        "GROQ_API_KEY": "q-key",
    })
    assert [p.name for p in cfg.text_chain] == ["gemini", "groq"]


def test_vision_chain_is_gemini_only():
    cfg = load_config({
        "GEMINI_API_KEY": "g-key",
        "GROQ_API_KEY": "q-key",
    })
    assert [p.name for p in cfg.vision_chain] == ["gemini"]
    assert all(p.supports_vision for p in cfg.vision_chain)


def test_groq_only_key_gives_empty_vision_chain():
    cfg = load_config({"GROQ_API_KEY": "q-key"})
    assert [p.name for p in cfg.text_chain] == ["groq"]
    assert cfg.vision_chain == []


def test_models_are_overridable_by_env():
    cfg = load_config({
        "GEMINI_API_KEY": "g-key",
        "GEMINI_TEXT_MODEL": "custom-text",
        "GEMINI_VISION_MODEL": "custom-vision",
    })
    assert cfg.text_chain[0].model == "custom-text"
    assert cfg.vision_chain[0].model == "custom-vision"


def test_primary_provider_can_be_flipped_to_groq():
    cfg = load_config({
        "GEMINI_API_KEY": "g-key",
        "GROQ_API_KEY": "q-key",
        "AI_PRIMARY_PROVIDER": "groq",
    })
    assert [p.name for p in cfg.text_chain] == ["groq", "gemini"]
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd backend && venv/bin/python3 -m pytest tests/test_ai_provider.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ai_provider'`

- [ ] **Step 5: Write the minimal implementation**

Substitute the model IDs confirmed in Task 1 for the two `_DEFAULT_GEMINI_*`
values.

```python
# backend/ai_provider.py
"""Provider-agnostic JSON completions with primary/fallback dispatch.

Gemini and Groq both expose OpenAI-compatible chat completion endpoints, so a
single client class serves both; only base_url, key and model differ.

Callers name a task ("text" or "vision"), never a model. Model names live here
and in configuration only -- hardcoding them at call sites is what caused the
outage this module was written to fix.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

TEXT = "text"
VISION = "vision"

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

# Verified against the live account in Task 1 on 2026-09-02.
# Do not "upgrade" these without re-running that verification:
#   gemini-3.7-flash and gemini-flash-latest hang indefinitely (4/4 timeouts).
#   gemini-2.5-flash is retired ("no longer available to new users").
#   gemini-3.5-flash: text ~1.7s, vision ~10s, consistent.
_DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.5-flash"
_DEFAULT_GEMINI_VISION_MODEL = "gemini-3.5-flash"
_DEFAULT_GROQ_TEXT_MODEL = "qwen/qwen3.8-27b"

# Vision calls measured at ~10-12s, with occasional 29s outliers, so the old
# 25s Groq timeout is too tight.
_DEFAULT_TIMEOUT_SECONDS = 45.0
_DEFAULT_RETRIES = 1


@dataclass(frozen=True)
class ProviderSpec:
    name: str
    api_key: str
    base_url: str
    model: str
    supports_vision: bool


@dataclass(frozen=True)
class AIConfig:
    text_chain: list[ProviderSpec]
    vision_chain: list[ProviderSpec]
    timeout_seconds: float
    retries: int


def load_config(env: Mapping[str, str]) -> AIConfig:
    gemini_key = (env.get("GEMINI_API_KEY") or "").strip()
    groq_key = (env.get("GROQ_API_KEY") or "").strip()

    gemini_text = gemini_vision = None
    if gemini_key:
        gemini_text = ProviderSpec(
            name="gemini",
            api_key=gemini_key,
            base_url=GEMINI_BASE_URL,
            model=(env.get("GEMINI_TEXT_MODEL") or _DEFAULT_GEMINI_TEXT_MODEL).strip(),
            supports_vision=False,
        )
        gemini_vision = ProviderSpec(
            name="gemini",
            api_key=gemini_key,
            base_url=GEMINI_BASE_URL,
            model=(env.get("GEMINI_VISION_MODEL") or _DEFAULT_GEMINI_VISION_MODEL).strip(),
            supports_vision=True,
        )

    groq_text = None
    if groq_key:
        groq_text = ProviderSpec(
            name="groq",
            api_key=groq_key,
            base_url=GROQ_BASE_URL,
            model=(env.get("GROQ_TEXT_MODEL") or _DEFAULT_GROQ_TEXT_MODEL).strip(),
            supports_vision=False,
        )

    text_chain = [p for p in (gemini_text, groq_text) if p is not None]
    if (env.get("AI_PRIMARY_PROVIDER") or "gemini").strip().lower() == "groq":
        text_chain.reverse()

    # Groq has no vision-capable model on this account, so vision cannot fall
    # back. Callers get a typed error instead of a silent 500.
    vision_chain = [p for p in (gemini_vision,) if p is not None]

    return AIConfig(
        text_chain=text_chain,
        vision_chain=vision_chain,
        timeout_seconds=float(env.get("AI_TIMEOUT_SECONDS") or _DEFAULT_TIMEOUT_SECONDS),
        retries=int(env.get("AI_RETRIES") or _DEFAULT_RETRIES),
    )
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && venv/bin/python3 -m pytest tests/test_ai_provider.py -v`
Expected: 5 passed

- [ ] **Step 7: Commit**

```bash
git add backend/ai_provider.py backend/tests/ backend/pytest.ini backend/requirements.txt
git commit -m "Add AI provider configuration with task-based chains"
```

---

### Task 3: JSON completion against a single provider

**Files:**
- Modify: `backend/ai_provider.py`
- Modify: `backend/tests/test_ai_provider.py`

**Interfaces:**
- Consumes: `ProviderSpec`, `AIConfig` from Task 2.
- Produces: `safe_json_loads(raw_text: str) -> dict`,
  `complete_json(spec, messages, max_tokens, temperature, timeout_seconds, retries, client_factory) -> dict`.
  `client_factory(spec) -> client` returns any object exposing
  `client.chat.completions.create(...)`, which is how tests inject stubs.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_ai_provider.py`:

```python
from ai_provider import ProviderSpec, complete_json, safe_json_loads


class _StubMessage:
    def __init__(self, content):
        self.content = content


class _StubChoice:
    def __init__(self, content):
        self.message = _StubMessage(content)


class _StubResponse:
    def __init__(self, content):
        self.choices = [_StubChoice(content)]


class _StubCompletions:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return _StubResponse(item)


class _StubClient:
    def __init__(self, script):
        self.chat = type("_Chat", (), {})()
        self.chat.completions = _StubCompletions(script)


SPEC = ProviderSpec(name="gemini", api_key="k", base_url="http://x",
                    model="m", supports_vision=False)


def _factory(script):
    client = _StubClient(script)
    return (lambda spec: client), client


def test_safe_json_loads_parses_plain_json():
    assert safe_json_loads('{"a": 1}') == {"a": 1}


def test_safe_json_loads_recovers_json_embedded_in_prose():
    assert safe_json_loads('here you go: {"a": 1} thanks') == {"a": 1}


def test_safe_json_loads_returns_empty_dict_on_garbage():
    assert safe_json_loads("not json at all") == {}
    assert safe_json_loads("") == {}


def test_complete_json_returns_parsed_payload():
    factory, _ = _factory(['{"merchant": "Cafe"}'])
    out = complete_json(SPEC, [{"role": "user", "content": "x"}],
                        max_tokens=100, temperature=0,
                        timeout_seconds=5, retries=0, client_factory=factory)
    assert out == {"merchant": "Cafe"}


def test_complete_json_requests_json_object_mode():
    factory, client = _factory(['{"a": 1}'])
    complete_json(SPEC, [{"role": "user", "content": "x"}],
                  max_tokens=100, temperature=0,
                  timeout_seconds=5, retries=0, client_factory=factory)
    kwargs = client.chat.completions.calls[0]
    assert kwargs["response_format"] == {"type": "json_object"}
    assert kwargs["model"] == "m"
    assert kwargs["max_tokens"] == 100


def test_complete_json_retries_then_succeeds():
    factory, client = _factory([RuntimeError("boom"), '{"a": 1}'])
    out = complete_json(SPEC, [{"role": "user", "content": "x"}],
                        max_tokens=100, temperature=0,
                        timeout_seconds=5, retries=1, client_factory=factory)
    assert out == {"a": 1}
    assert len(client.chat.completions.calls) == 2


def test_complete_json_raises_after_exhausting_retries():
    factory, _ = _factory([RuntimeError("boom"), RuntimeError("boom again")])
    with pytest.raises(RuntimeError):
        complete_json(SPEC, [{"role": "user", "content": "x"}],
                      max_tokens=100, temperature=0,
                      timeout_seconds=5, retries=1, client_factory=factory)


def test_complete_json_treats_empty_json_as_failure():
    factory, _ = _factory(["not json", "also not json"])
    with pytest.raises(ValueError):
        complete_json(SPEC, [{"role": "user", "content": "x"}],
                      max_tokens=100, temperature=0,
                      timeout_seconds=5, retries=1, client_factory=factory)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && venv/bin/python3 -m pytest tests/test_ai_provider.py -v`
Expected: FAIL — `ImportError: cannot import name 'complete_json'`

- [ ] **Step 3: Write the implementation**

Add to `backend/ai_provider.py`:

```python
import json
import logging
import re
import time
from typing import Any, Callable, Sequence

logger = logging.getLogger(__name__)


def safe_json_loads(raw_text: str) -> dict:
    """Parse a model's JSON reply, tolerating prose wrapped around it."""
    if not raw_text:
        return {}
    try:
        return json.loads(raw_text)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", raw_text)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return {}
    return {}


def _default_client_factory(spec: ProviderSpec):
    from openai import OpenAI
    return OpenAI(api_key=spec.api_key, base_url=spec.base_url)


def complete_json(
    spec: ProviderSpec,
    messages: Sequence[dict],
    max_tokens: int,
    temperature: float,
    timeout_seconds: float,
    retries: int,
    client_factory: Callable[[ProviderSpec], Any] = _default_client_factory,
) -> dict:
    """One provider, with retries. Raises the last error if every attempt fails."""
    client = client_factory(spec)
    last_err: Exception | None = None

    for attempt in range(retries + 1):
        try:
            resp = client.chat.completions.create(
                model=spec.model,
                messages=list(messages),
                response_format={"type": "json_object"},
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=timeout_seconds,
            )
            parsed = safe_json_loads(resp.choices[0].message.content)
            if isinstance(parsed, dict) and parsed:
                return parsed
            raise ValueError(f"{spec.name}/{spec.model} returned empty or invalid JSON")
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(0.45 * (attempt + 1))
                continue
            break

    raise last_err
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && venv/bin/python3 -m pytest tests/test_ai_provider.py -v`
Expected: 13 passed

- [ ] **Step 5: Commit**

```bash
git add backend/ai_provider.py backend/tests/test_ai_provider.py
git commit -m "Add single-provider JSON completion with retries"
```

---

### Task 4: Provider chain dispatch with fallback

**Files:**
- Modify: `backend/ai_provider.py`
- Modify: `backend/tests/test_ai_provider.py`

**Interfaces:**
- Consumes: `complete_json`, `AIConfig`, `load_config` from Tasks 2-3.
- Produces: `AIUnavailableError(task, failures)` with attributes `.task` and
  `.failures`, and
  `call_ai_json(messages, task, max_tokens, temperature=0, config=None, client_factory=None) -> dict`.
  This is the only function `main.py` will call.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_ai_provider.py`:

```python
from ai_provider import AIConfig, AIUnavailableError, call_ai_json

GEMINI = ProviderSpec("gemini", "k", "http://g", "gm", False)
GROQ = ProviderSpec("groq", "k", "http://q", "qm", False)
GEMINI_V = ProviderSpec("gemini", "k", "http://g", "gv", True)


def _cfg(text_chain, vision_chain):
    return AIConfig(text_chain=text_chain, vision_chain=vision_chain,
                    timeout_seconds=5, retries=0)


def _multi_factory(by_model):
    """Return a factory serving a different scripted client per model."""
    clients = {model: _StubClient(script) for model, script in by_model.items()}
    return (lambda spec: clients[spec.model]), clients


def test_text_task_uses_primary_when_it_succeeds():
    factory, clients = _multi_factory({"gm": ['{"from": "gemini"}'], "qm": []})
    out = call_ai_json([{"role": "user", "content": "x"}], task=TEXT,
                       max_tokens=50, config=_cfg([GEMINI, GROQ], [GEMINI_V]),
                       client_factory=factory)
    assert out == {"from": "gemini"}
    assert clients["qm"].chat.completions.calls == []


def test_text_task_falls_back_to_groq_when_primary_fails():
    factory, clients = _multi_factory({
        "gm": [RuntimeError("gemini down")],
        "qm": ['{"from": "groq"}'],
    })
    out = call_ai_json([{"role": "user", "content": "x"}], task=TEXT,
                       max_tokens=50, config=_cfg([GEMINI, GROQ], [GEMINI_V]),
                       client_factory=factory)
    assert out == {"from": "groq"}
    assert len(clients["qm"].chat.completions.calls) == 1


def test_text_task_raises_when_every_provider_fails():
    factory, _ = _multi_factory({
        "gm": [RuntimeError("gemini down")],
        "qm": [RuntimeError("groq down")],
    })
    with pytest.raises(AIUnavailableError) as exc:
        call_ai_json([{"role": "user", "content": "x"}], task=TEXT,
                     max_tokens=50, config=_cfg([GEMINI, GROQ], [GEMINI_V]),
                     client_factory=factory)
    assert exc.value.task == TEXT
    assert len(exc.value.failures) == 2


def test_vision_task_does_not_fall_back_to_groq():
    factory, clients = _multi_factory({
        "gv": [RuntimeError("gemini down")],
        "qm": ['{"from": "groq"}'],
    })
    with pytest.raises(AIUnavailableError) as exc:
        call_ai_json([{"role": "user", "content": "x"}], task=VISION,
                     max_tokens=50, config=_cfg([GEMINI, GROQ], [GEMINI_V]),
                     client_factory=factory)
    assert exc.value.task == VISION
    assert clients["qm"].chat.completions.calls == []


def test_vision_task_raises_when_no_vision_provider_configured():
    factory, _ = _multi_factory({"qm": []})
    with pytest.raises(AIUnavailableError):
        call_ai_json([{"role": "user", "content": "x"}], task=VISION,
                     max_tokens=50, config=_cfg([GROQ], []),
                     client_factory=factory)


def test_unknown_task_is_rejected():
    factory, _ = _multi_factory({})
    with pytest.raises(ValueError):
        call_ai_json([{"role": "user", "content": "x"}], task="audio",
                     max_tokens=50, config=_cfg([GEMINI], [GEMINI_V]),
                     client_factory=factory)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && venv/bin/python3 -m pytest tests/test_ai_provider.py -v`
Expected: FAIL — `ImportError: cannot import name 'AIUnavailableError'`

- [ ] **Step 3: Write the implementation**

Add to `backend/ai_provider.py`:

```python
import os

_ACTIVE_CONFIG: AIConfig | None = None


class AIUnavailableError(RuntimeError):
    """Every provider for a task failed. Callers map this to a 503."""

    def __init__(self, task: str, failures: list[str]):
        self.task = task
        self.failures = failures
        super().__init__(
            f"All providers failed for task={task}: " + "; ".join(failures)
        )


def get_config() -> AIConfig:
    """Process-wide config, loaded once from the environment."""
    global _ACTIVE_CONFIG
    if _ACTIVE_CONFIG is None:
        _ACTIVE_CONFIG = load_config(os.environ)
    return _ACTIVE_CONFIG


def call_ai_json(
    messages: Sequence[dict],
    task: str,
    max_tokens: int,
    temperature: float = 0,
    config: AIConfig | None = None,
    client_factory: Callable[[ProviderSpec], Any] | None = None,
) -> dict:
    """Run a JSON completion for a task, trying each provider in turn.

    Text tasks fall back from Gemini to Groq. Vision tasks cannot fall back --
    the Groq account has no vision model -- so they raise AIUnavailableError,
    which the API layer turns into an honest 503 rather than a generic 500.
    """
    cfg = config or get_config()
    if task == TEXT:
        chain = cfg.text_chain
    elif task == VISION:
        chain = cfg.vision_chain
    else:
        raise ValueError(f"Unknown task: {task!r}")

    kwargs = {}
    if client_factory is not None:
        kwargs["client_factory"] = client_factory

    failures: list[str] = []
    for spec in chain:
        try:
            result = complete_json(
                spec,
                messages,
                max_tokens=max_tokens,
                temperature=temperature,
                timeout_seconds=cfg.timeout_seconds,
                retries=cfg.retries,
                **kwargs,
            )
            if failures:
                logger.warning(
                    "ai task=%s served by fallback %s/%s after %d failure(s)",
                    task, spec.name, spec.model, len(failures),
                )
            else:
                logger.info("ai task=%s served by %s/%s", task, spec.name, spec.model)
            return result
        except Exception as e:
            failures.append(f"{spec.name}/{spec.model}: {e}")
            logger.warning("ai provider failed task=%s %s/%s: %s",
                           task, spec.name, spec.model, e)

    if not chain:
        failures.append(f"no provider configured for task={task}")
    raise AIUnavailableError(task, failures)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && venv/bin/python3 -m pytest tests/test_ai_provider.py -v`
Expected: 19 passed

- [ ] **Step 5: Commit**

```bash
git add backend/ai_provider.py backend/tests/test_ai_provider.py
git commit -m "Add provider chain dispatch with text fallback and vision-only errors"
```

---

### Task 5: Startup catalog check and health reporting

A configured model that the account cannot reach should be visible at boot, not
discovered as a 500 during someone's upload. That is exactly how the original
outage stayed hidden.

**Files:**
- Modify: `backend/ai_provider.py`
- Modify: `backend/tests/test_ai_provider.py`
- Modify: `backend/main.py:1512-1519` (the `/health` endpoint)

**Interfaces:**
- Consumes: `AIConfig`, `get_config` from Task 4.
- Produces: `describe_providers(config=None) -> list[dict]` returning one dict
  per configured provider with keys `name`, `model`, `task`;
  `check_models(config=None, client_factory=None) -> list[str]` returning a list
  of human-readable warnings (empty when all configured models are reachable).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_ai_provider.py`:

```python
from ai_provider import check_models, describe_providers


class _StubModels:
    def __init__(self, ids):
        self._ids = ids

    def list(self):
        return [type("_M", (), {"id": i})() for i in self._ids]


class _CatalogClient:
    def __init__(self, ids):
        self.models = _StubModels(ids)


def test_describe_providers_lists_each_task_and_model():
    rows = describe_providers(_cfg([GEMINI, GROQ], [GEMINI_V]))
    assert {"name": "gemini", "model": "gm", "task": TEXT} in rows
    assert {"name": "groq", "model": "qm", "task": TEXT} in rows
    assert {"name": "gemini", "model": "gv", "task": VISION} in rows


def test_check_models_is_silent_when_every_model_is_reachable():
    factory = lambda spec: _CatalogClient(["gm", "qm", "gv"])
    assert check_models(_cfg([GEMINI, GROQ], [GEMINI_V]), factory) == []


def test_check_models_warns_about_a_missing_model():
    factory = lambda spec: _CatalogClient(["qm", "gv"])
    warnings = check_models(_cfg([GEMINI, GROQ], [GEMINI_V]), factory)
    assert len(warnings) == 1
    assert "gm" in warnings[0]


def test_check_models_warns_when_catalog_cannot_be_read():
    def factory(spec):
        raise RuntimeError("network down")
    warnings = check_models(_cfg([GEMINI], [GEMINI_V]), factory)
    assert warnings and "network down" in warnings[0]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && venv/bin/python3 -m pytest tests/test_ai_provider.py -v`
Expected: FAIL — `ImportError: cannot import name 'check_models'`

- [ ] **Step 3: Write the implementation**

Add to `backend/ai_provider.py`:

```python
def describe_providers(config: AIConfig | None = None) -> list[dict]:
    cfg = config or get_config()
    rows = [{"name": s.name, "model": s.model, "task": TEXT} for s in cfg.text_chain]
    rows += [{"name": s.name, "model": s.model, "task": VISION} for s in cfg.vision_chain]
    return rows


def check_models(
    config: AIConfig | None = None,
    client_factory: Callable[[ProviderSpec], Any] | None = None,
) -> list[str]:
    """Warn about configured models the account cannot actually reach.

    Provider catalogs drift. Surfacing that at boot beats discovering it as a
    500 mid-upload, which is how the Groq deprecation went unnoticed.
    """
    cfg = config or get_config()
    factory = client_factory or _default_client_factory

    warnings: list[str] = []
    catalogs: dict[str, set[str]] = {}

    for spec in list(cfg.text_chain) + list(cfg.vision_chain):
        if spec.name not in catalogs:
            try:
                client = factory(spec)
                catalogs[spec.name] = {m.id for m in client.models.list()}
            except Exception as e:
                warnings.append(f"could not read {spec.name} model catalog: {e}")
                catalogs[spec.name] = set()
                continue
        available = catalogs[spec.name]
        if available and spec.model not in available:
            warnings.append(
                f"{spec.name} model {spec.model!r} is not in the account's catalog"
            )
    return warnings
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && venv/bin/python3 -m pytest tests/test_ai_provider.py -v`
Expected: 23 passed

- [ ] **Step 5: Report providers from /health**

Replace `backend/main.py:1512-1519` with:

```python
def health():
    return {
        "status": "ok" if not BOOT_ERRORS else "degraded",
        "supabase_configured": supabase is not None,
        "ai_providers": ai_provider.describe_providers(),
        "boot_errors": BOOT_ERRORS,
        "time": datetime.utcnow().isoformat(),
    }
```

Add `import ai_provider` alongside the other imports at the top of `main.py`.
Note this removes the `groq_configured` key, which no longer describes reality
now that there are two providers.

- [ ] **Step 6: Verify health responds**

Run: `cd backend && venv/bin/python3 -c "import main; print(main.health())"`
Expected: a dict whose `ai_providers` lists the configured provider/model/task rows.

- [ ] **Step 7: Commit**

```bash
git add backend/ai_provider.py backend/tests/test_ai_provider.py backend/main.py
git commit -m "Warn on unreachable models and report providers from /health"
```

---

### Task 6: Wire main.py's call sites to the provider layer

**Files:**
- Modify: `backend/main.py` — delete `call_groq_json` (lines 278-304) and
  `safe_json_loads` (lines 263-275); update six call sites; remove the Groq
  client boot block and `require_groq`.

**Interfaces:**
- Consumes: `call_ai_json`, `TEXT`, `VISION` from Task 4.
- Produces: no new interfaces. After this task no model name appears in `main.py`.

Call sites and their tasks (line numbers are pre-change):

| Line | Purpose | Task | Token budget |
|---|---|---|---|
| 923 | trip planning | `TEXT` | `TRIP_MAX_TOKENS` |
| 1100 | PDF receipt extraction | `TEXT` | `OCR_MAX_TOKENS` |
| 1112 | image receipt OCR | `VISION` | `OCR_MAX_TOKENS` |
| 1156 | policy audit (receipt) | `TEXT` | `AUDIT_MAX_TOKENS` |
| 1375 | policy audit (expense) | `TEXT` | `AUDIT_MAX_TOKENS` |
| 1663 | policy Q&A assistant | `TEXT` | `1500` (was `260`) |

- [ ] **Step 0: Raise the token budgets for thinking models**

Task 1 measured Gemini 3.x consuming 670-840 tokens of *invisible* reasoning
before emitting any JSON, and that reasoning counts against `max_tokens`. At the
current budgets every call returns `finish_reason: length` with truncated JSON —
a drop-in swap would fail 100% of the time. Thinking cannot be disabled:
`reasoning_effort: "none"` returns 400 and `"low"` still burns ~476 tokens.

Raising these is safe for Groq, which simply stops at its stop token well below
the ceiling (qwen used 231 tokens for a full receipt).

Replace the budget constants in `backend/main.py`:

```python
# Gemini 3.x spends 670-840 tokens on hidden reasoning before its first visible
# token, and that counts against max_tokens. These ceilings cover reasoning plus
# roughly 250 tokens of actual JSON. Groq stops well short of them.
OCR_MAX_TOKENS = 1800
AUDIT_MAX_TOKENS = 1500
TRIP_MAX_TOKENS = 2500
```

The hardcoded `260` at the policy Q&A call site becomes `1500` in Step 6.

- [ ] **Step 1: Add the import and delete the old helpers**

At the top of `backend/main.py`, add:

```python
import ai_provider
from ai_provider import call_ai_json, TEXT, VISION, AIUnavailableError
```

Delete `safe_json_loads` (lines 263-275) and `call_groq_json` (lines 278-304) —
both now live in `ai_provider.py`.

Delete the Groq boot block (the `groq_client = None` / `if GROQ_API_KEY:` stanza)
and the `require_groq` function (lines 68-73). `GROQ_API_KEY` is now read by
`ai_provider.load_config`.

Delete the now-unused model and retry constants: `OCR_MODEL`, `AUDIT_MODEL`,
`OCR_RETRIES`, `AUDIT_RETRIES`, `GROQ_TIMEOUT_SECONDS`. Keep `FAST_MODE`,
`OCR_MAX_TOKENS`, `AUDIT_MAX_TOKENS`, `TRIP_MAX_TOKENS`, and the PDF limits.

- [ ] **Step 2: Update the trip planning call (was line 923)**

```python
        llm_json = call_ai_json(
            messages=[{"role": "user", "content": prompt}],
            task=TEXT,
            max_tokens=TRIP_MAX_TOKENS,
            temperature=0.1,
        )
```

- [ ] **Step 3: Update the PDF extraction call (was line 1100)**

```python
            extracted = call_ai_json(
                messages=[{
                    "role": "user",
                    "content": f"{ocr_prompt}\n\nReceipt text:\n{pdf_text[:RECEIPT_PDF_TEXT_MAX_CHARS]}"
                }],
                task=TEXT,
                max_tokens=OCR_MAX_TOKENS,
                temperature=0,
            )
```

- [ ] **Step 4: Update the image OCR call (was line 1112)**

The message shape is unchanged — this is the shape Task 1 confirmed Gemini's
compat layer accepts.

```python
            image_b64 = base64.b64encode(content).decode()
            extracted = call_ai_json(
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": ocr_prompt},
                        {"type": "image_url", "image_url": {
                            "url": f"data:{mime};base64,{image_b64}"}}
                    ]
                }],
                task=VISION,
                max_tokens=OCR_MAX_TOKENS,
                temperature=0,
            )
```

- [ ] **Step 5: Update both policy audit calls (was lines 1156 and 1375)**

Both become, keeping their surrounding `try`/`except` fallback blocks exactly as
they are:

```python
            audit = call_ai_json(
                messages=[{"role": "user", "content": audit_prompt}],
                task=TEXT,
                max_tokens=AUDIT_MAX_TOKENS,
                temperature=0,
            )
```

- [ ] **Step 6: Update the policy Q&A call (was line 1663)**

```python
        result = call_ai_json(
            messages=[{"role": "user", "content": prompt}],
            task=TEXT,
            max_tokens=1500,
            temperature=0,
        )
```

- [ ] **Step 7: Verify no model names or old helpers remain**

```bash
cd backend
grep -n "call_groq_json\|require_groq\|OCR_MODEL\|AUDIT_MODEL\|llama-\|qwen/" main.py
```
Expected: no output.

```bash
venv/bin/python3 -c "import main; print('imports clean')"
```
Expected: `imports clean`

- [ ] **Step 8: Run the full test suite**

Run: `cd backend && venv/bin/python3 -m pytest -v`
Expected: 23 passed

- [ ] **Step 9: Commit**

```bash
git add backend/main.py
git commit -m "Route all LLM calls through the task-based provider layer"
```

---

### Task 7: Typed error handling in extract_receipt

**Files:**
- Modify: `backend/main.py` — the `extract_receipt` exception tail (was lines 1221-1225).

**Interfaces:**
- Consumes: `AIUnavailableError` from Task 4.
- Produces: no new interfaces. Changes the HTTP contract: provider outages now
  return 503 with a specific message instead of 500 with a leaked exception string.

- [ ] **Step 1: Replace the catch-all handler**

Replace:

```python
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Receipt processing failed: {str(e)}")
```

with:

```python
    except HTTPException:
        raise
    except AIUnavailableError as e:
        # A provider outage is not the caller's fault and is not permanent.
        # Say so precisely; a generic 500 sent users hunting for bugs that
        # were never in their receipt.
        logger.error("receipt AI unavailable task=%s failures=%s", e.task, e.failures)
        if e.task == VISION:
            detail = ("Image scanning is temporarily unavailable — please try "
                      "again shortly, or upload a PDF receipt.")
        else:
            detail = ("Receipt processing is temporarily unavailable — please "
                      "try again shortly.")
        raise HTTPException(status_code=503, detail=detail)
    except Exception as e:
        # Genuinely unexpected. Log the detail server-side; do not leak
        # internals such as database constraint names to the client.
        logger.exception("receipt processing failed")
        raise HTTPException(
            status_code=500,
            detail="Receipt processing failed unexpectedly. Please try again.")
```

- [ ] **Step 2: Add the module logger if absent**

Near the top of `backend/main.py`, after the imports:

```python
import logging
logger = logging.getLogger(__name__)
```

- [ ] **Step 3: Verify the vision path returns 503, not 500**

With no Gemini key configured, the vision chain is empty, so image uploads must
now fail as 503:

```bash
cd backend && GEMINI_API_KEY="" venv/bin/python3 -c "
import asyncio, io, base64, importlib
import ai_provider, main
importlib.reload(ai_provider); importlib.reload(main)
from fastapi import UploadFile
from starlette.datastructures import Headers

jpg = base64.b64decode('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==')

class U: id='e59f43ba-8e61-4c78-a0f6-c3b63cb9a10e'

async def go():
    up = UploadFile(filename='r.jpg', file=io.BytesIO(jpg),
                    headers=Headers({'content-type':'image/jpeg'}))
    try:
        await main.extract_receipt(file=up, business_purpose='lunch',
            employee_name='t', company_id='default', claim_id='', user=U())
        print('UNEXPECTED SUCCESS')
    except Exception as e:
        print('status:', getattr(e,'status_code',None))
        print('detail:', getattr(e,'detail',e))
asyncio.run(go())
"
```
Expected: `status: 503` and the image-specific message — not a 500.

- [ ] **Step 4: Run the full test suite**

Run: `cd backend && venv/bin/python3 -m pytest -v`
Expected: 23 passed

- [ ] **Step 5: Commit**

```bash
git add backend/main.py
git commit -m "Return 503 with an actionable message when AI providers are down"
```

---

### Task 8: Live end-to-end verification

**Requires:** `GEMINI_API_KEY` set in `backend/.env`.

**Files:**
- Create: `/tmp/verify_e2e.py` (throwaway, not committed)

**Interfaces:**
- Consumes: everything above.
- Produces: evidence that both receipt paths work against the live database.

- [ ] **Step 1: Verify the PDF path**

```bash
cd backend && venv/bin/python3 -c "
import asyncio, io
import main
from fastapi import UploadFile
from starlette.datastructures import Headers

class U: id='e59f43ba-8e61-4c78-a0f6-c3b63cb9a10e'

async def go():
    up = UploadFile(filename='receipt.pdf', file=io.BytesIO(open('/tmp/receipt.pdf','rb').read()),
                    headers=Headers({'content-type':'application/pdf'}))
    r = await main.extract_receipt(file=up, business_purpose='client meeting lunch',
        employee_name='Sohin', company_id='default', claim_id='', user=U())
    d = r['data']
    print('PDF OK:', d.get('vendor_name'), d.get('amount'), d.get('currency'), d.get('status'))
asyncio.run(go())
"
```
Expected: `PDF OK: Hotel Restaurant and Bar 60.76 USD <status>`

- [ ] **Step 2: Verify the image path — the bug this project exists to fix**

Use a real receipt photo, not the 1x1 test pixel.

```bash
cd backend && venv/bin/python3 -c "
import asyncio, io
import main
from fastapi import UploadFile
from starlette.datastructures import Headers

class U: id='e59f43ba-8e61-4c78-a0f6-c3b63cb9a10e'

async def go():
    path = '<PATH_TO_A_REAL_RECEIPT>.jpg'
    up = UploadFile(filename='receipt.jpg', file=io.BytesIO(open(path,'rb').read()),
                    headers=Headers({'content-type':'image/jpeg'}))
    r = await main.extract_receipt(file=up, business_purpose='client meeting lunch',
        employee_name='Sohin', company_id='default', claim_id='', user=U())
    d = r['data']
    print('IMAGE OK:', d.get('vendor_name'), d.get('amount'), d.get('currency'), d.get('status'))
asyncio.run(go())
"
```
Expected: `IMAGE OK:` with the merchant and amount read from the photo. This is
the case that returned 500 before this work.

- [ ] **Step 3: Verify text fallback actually engages**

Break Gemini deliberately and confirm a PDF still processes via Groq:

```bash
cd backend && GEMINI_API_KEY="invalid-key-on-purpose" venv/bin/python3 -c "
import asyncio, io, importlib
import ai_provider, main
importlib.reload(ai_provider); importlib.reload(main)
from fastapi import UploadFile
from starlette.datastructures import Headers

class U: id='e59f43ba-8e61-4c78-a0f6-c3b63cb9a10e'

async def go():
    up = UploadFile(filename='receipt.pdf', file=io.BytesIO(open('/tmp/receipt.pdf','rb').read()),
                    headers=Headers({'content-type':'application/pdf'}))
    r = await main.extract_receipt(file=up, business_purpose='lunch',
        employee_name='Sohin', company_id='default', claim_id='', user=U())
    print('FALLBACK OK:', r['data'].get('vendor_name'))
asyncio.run(go())
" 2>&1 | grep -E "FALLBACK OK|fallback"
```
Expected: a log line showing the fallback served the request, and `FALLBACK OK:`
with the merchant name.

- [ ] **Step 4: Verify the running server through HTTP**

Restart the backend, then confirm `/health` reports both providers:

```bash
curl -s http://127.0.0.1:8000/health | python3 -m json.tool
```
Expected: `ai_providers` lists gemini (text), groq (text), and gemini (vision).

- [ ] **Step 5: Confirm in the browser**

Log in, open Scan Receipt, upload a JPG receipt with a business purpose, and
submit. Expected: extraction populates and an audit result appears — no 500.

- [ ] **Step 6: Commit any fixes discovered during verification**

```bash
git add -A backend/
git commit -m "Fix issues found during live provider verification"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Env vars `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_VISION_MODEL`, `AI_PRIMARY_PROVIDER` | 2 |
| `call_ai_json(messages, task, ...)` replaces `call_groq_json` | 4 |
| All six call sites updated, no model names in code | 6 |
| OpenAI-compat transport, verified first, native SDK as fallback plan | 1 |
| `openai` added to requirements with pinning | 2 |
| Text: Gemini → Groq; vision: Gemini only | 4 |
| Retry/timeout carried over; provider logged per call | 3, 4 |
| 503 with task-specific message; 400s retained; DB errors logged not leaked | 7 |
| Policy audit still degrades to "Flagged" rather than failing | 6 (Step 5 preserves the existing try/except) |
| Startup catalog check warning on drift | 5 |
| Live verification of both paths + forced-failure drill | 8 |

No gaps.

**Placeholder scan:** Two intentional substitution markers remain —
`<CONFIRMED_IN_TASK_1>` for model defaults and `<PATH_TO_A_REAL_RECEIPT>` for
the test image. Both are values that cannot be known until Task 1 runs against a
live key; each is explicitly sourced by a prior step rather than left to
invention.

**Type consistency:** `ProviderSpec` fields (`name`, `api_key`, `base_url`,
`model`, `supports_vision`) are used identically in Tasks 2-5. `AIConfig` fields
(`text_chain`, `vision_chain`, `timeout_seconds`, `retries`) match across
`load_config`, `call_ai_json`, `describe_providers`, and `check_models`.
`client_factory` has the same signature — `(ProviderSpec) -> client` — in
`complete_json`, `call_ai_json`, and `check_models`. `AIUnavailableError`
exposes `.task` and `.failures`, both consumed in Task 7.
