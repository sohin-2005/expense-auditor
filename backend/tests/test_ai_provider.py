import pytest
import ai_provider
from ai_provider import ProviderSpec, complete_json, load_config, safe_json_loads, TEXT, VISION
from ai_provider import AIConfig, AIUnavailableError, call_ai_json


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


def test_check_models_treats_models_prefix_as_same_model():
    """Gemini's /models endpoint returns IDs like 'models/gemini-3.5-flash',
    but chat/completions requires -- and we correctly configure -- the bare
    form. A naive membership test warns on every healthy boot; comparison
    must normalize the 'models/' prefix away.
    """
    factory = lambda spec: _CatalogClient(["models/gm", "models/qm", "models/gv"])
    assert check_models(_cfg([GEMINI, GROQ], [GEMINI_V]), factory) == []


def test_check_models_still_warns_about_a_genuinely_missing_model_with_prefixed_catalog():
    factory = lambda spec: _CatalogClient(["models/other-model"])
    warnings = check_models(_cfg([GEMINI], []), factory)
    assert len(warnings) == 1
    assert "gm" in warnings[0]


def test_check_models_warns_when_no_provider_is_configured():
    warnings = check_models(_cfg([], []))
    assert warnings
    assert "no ai provider" in warnings[0].lower()


def test_catalog_client_factory_uses_a_short_explicit_timeout(monkeypatch):
    """The catalog probe must fail fast, not inherit the SDK's 600s default.

    A bad model against this same Gemini endpoint has hung past 120-180s in
    this project before -- boot cannot be left exposed to that. Stubs out
    openai.OpenAI so no real client or network call is involved; this only
    checks what the catalog factory passes when constructing a client.
    """
    captured = {}

    class _StubOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr("openai.OpenAI", _StubOpenAI)
    ai_provider._catalog_client_factory(SPEC)

    assert captured["timeout"] == ai_provider.CATALOG_CHECK_TIMEOUT_SECONDS
    assert ai_provider.CATALOG_CHECK_TIMEOUT_SECONDS == 5.0
