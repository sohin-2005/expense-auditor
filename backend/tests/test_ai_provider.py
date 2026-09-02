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
