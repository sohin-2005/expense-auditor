import pytest
import ai_provider
from ai_provider import ProviderSpec, complete_json, load_config, safe_json_loads, TEXT, VISION


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
