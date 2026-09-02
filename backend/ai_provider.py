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
