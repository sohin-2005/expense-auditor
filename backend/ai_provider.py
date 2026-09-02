"""Provider-agnostic JSON completions with primary/fallback dispatch.

Gemini and Groq both expose OpenAI-compatible chat completion endpoints, so a
single client class serves both; only base_url, key and model differ.

Callers name a task ("text" or "vision"), never a model. Model names live here
and in configuration only -- hardcoding them at call sites is what caused the
outage this module was written to fix.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Sequence

logger = logging.getLogger(__name__)

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

# The catalog probe in check_models() is a boot-time health check, not a
# user-facing completion, so it must fail fast rather than block startup.
# Earlier in this project, a bad model against this same Gemini endpoint
# hung past 120-180s with no response, and the OpenAI SDK's own default
# timeout is 600s -- far too long to sit in front of a deploy.
CATALOG_CHECK_TIMEOUT_SECONDS = 5.0


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
        timeout_seconds=_parse_float(
            "AI_TIMEOUT_SECONDS", env.get("AI_TIMEOUT_SECONDS"), _DEFAULT_TIMEOUT_SECONDS
        ),
        retries=_parse_int("AI_RETRIES", env.get("AI_RETRIES"), _DEFAULT_RETRIES),
    )


def _parse_float(name: str, raw: str | None, default: float) -> float:
    """Parse an optional numeric env var, falling back to `default` on any
    bad value instead of raising.

    load_config() runs at import time (backend/main.py imports ai_provider
    and reads get_config() at module scope), so an unguarded float()/int()
    here would turn a typo'd env var into a crashed boot -- exactly what
    BOOT_ERRORS exists to avoid. A malformed override degrading to the
    documented default, with a logged warning, is the correct failure mode.
    """
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning(
            "%s=%r is not a valid number; falling back to default %s",
            name, raw, default,
        )
        return default


def _parse_int(name: str, raw: str | None, default: int) -> int:
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning(
            "%s=%r is not a valid integer; falling back to default %s",
            name, raw, default,
        )
        return default
    if value < 0:
        logger.warning(
            "%s=%r is negative, which would break the retry loop; falling back to default %s",
            name, raw, default,
        )
        return default
    return value


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


def _catalog_client_factory(spec: ProviderSpec):
    """Default client factory for check_models()'s catalog probe only.

    Deliberately separate from _default_client_factory: user-facing
    completions need the longer AIConfig.timeout_seconds (45s, with vision
    measured at ~10-12s), but a boot-time catalog read has no business
    taking more than a few seconds -- so it gets its own short, explicit
    timeout instead of inheriting the SDK's 600s default.
    """
    from openai import OpenAI
    return OpenAI(
        api_key=spec.api_key,
        base_url=spec.base_url,
        timeout=CATALOG_CHECK_TIMEOUT_SECONDS,
        # The SDK default (max_retries=2) would multiply the timeout above by
        # up to 3 attempts plus backoff -- ~30s worst case across two
        # providers, exactly the boot-blocking exposure this factory exists
        # to close. The probe is best-effort and already retried on the next
        # boot, so zero retries here is correct.
        max_retries=0,
    )


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


def describe_providers(config: AIConfig | None = None) -> list[dict]:
    cfg = config or get_config()
    rows = [{"name": s.name, "model": s.model, "task": TEXT} for s in cfg.text_chain]
    rows += [{"name": s.name, "model": s.model, "task": VISION} for s in cfg.vision_chain]
    return rows


def _normalize_model_id(model_id: str) -> str:
    """Normalize a model id for catalog comparison only.

    Gemini's /models endpoint returns ids like 'models/gemini-3.5-flash',
    but chat/completions requires -- and we correctly configure and send --
    the bare form. Comparing the raw catalog id against the configured name
    warns on every healthy boot, which trains readers to ignore the log line
    the next real deprecation needs. This never touches what gets sent to
    the API; it only normalizes both sides of the comparison.
    """
    prefix = "models/"
    return model_id[len(prefix):] if model_id.startswith(prefix) else model_id


def check_models(
    config: AIConfig | None = None,
    client_factory: Callable[[ProviderSpec], Any] | None = None,
) -> list[str]:
    """Warn about configured models the account cannot actually reach.

    Provider catalogs drift. Surfacing that at boot beats discovering it as a
    500 mid-upload, which is how the Groq deprecation went unnoticed.
    """
    cfg = config or get_config()

    if not cfg.text_chain and not cfg.vision_chain:
        return ["no AI provider is configured: set GEMINI_API_KEY and/or GROQ_API_KEY"]

    factory = client_factory or _catalog_client_factory

    warnings: list[str] = []
    catalogs: dict[str, set[str]] = {}

    for spec in list(cfg.text_chain) + list(cfg.vision_chain):
        if spec.name not in catalogs:
            try:
                client = factory(spec)
                catalogs[spec.name] = {
                    _normalize_model_id(m.id) for m in client.models.list()
                }
            except Exception as e:
                warnings.append(f"could not read {spec.name} model catalog: {e}")
                catalogs[spec.name] = set()
                continue
        available = catalogs[spec.name]
        configured = _normalize_model_id(spec.model)
        if available and configured not in available:
            warnings.append(
                f"{spec.name} model {spec.model!r} is not in the account's catalog"
            )
    return warnings
