"""Model providers: Anthropic and OpenAI through their official SDKs, and any OpenAI-compatible
server (LM Studio, Ollama, vLLM, llama.cpp) through the OpenAI SDK with a base URL.

Keys come only from environment variables. A model stores the *name* of its variable
(`ANTHROPIC_API_KEY` by default), and the value is read at call time and never written anywhere."""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import anthropic
import openai

from evalbench.checks import visible_answer

PROVIDERS = {
    "anthropic": {
        "label": "Anthropic",
        "key_env": "ANTHROPIC_API_KEY",
        "base_url": None,
        "max_tokens": 16000,
        "suggested": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    },
    "openai": {
        "label": "OpenAI",
        "key_env": "OPENAI_API_KEY",
        "base_url": None,
        "max_tokens": 16000,
        "suggested": [],
    },
    "openai-compatible": {
        "label": "OpenAI-compatible",
        "key_env": None,
        "base_url": "http://host.docker.internal:1234/v1",
        "max_tokens": 4096,
        "suggested": [],
    },
}

PRESETS = [
    {"id": "lmstudio", "label": "LM Studio", "provider": "openai-compatible", "base_url": "http://host.docker.internal:1234/v1", "concurrency": 1},
    {"id": "ollama", "label": "Ollama", "provider": "openai-compatible", "base_url": "http://host.docker.internal:11434/v1", "concurrency": 1},
    {"id": "anthropic", "label": "Anthropic", "provider": "anthropic", "base_url": None, "concurrency": 4},
    {"id": "openai", "label": "OpenAI", "provider": "openai", "base_url": None, "concurrency": 4},
    {"id": "custom", "label": "Other OpenAI-compatible", "provider": "openai-compatible", "base_url": "", "concurrency": 2},
]

EFFORTS = ("low", "medium", "high", "xhigh", "max")


class ProviderError(Exception):
    pass


KEY_NAME = re.compile(r"^[A-Z][A-Z0-9_]*_(API_KEY|TOKEN)$")
OFFICIAL_KEYS = {"ANTHROPIC_API_KEY": {"api.anthropic.com"}, "OPENAI_API_KEY": {"api.openai.com"}}


def check_key_binding(provider: str, base_url: str | None, key_env: str | None) -> None:
    """Keys can only go where they belong. A variable must look like a key (ends in _API_KEY or
    _TOKEN, never an EVALBENCH_ setting), and the two provider keys are only ever sent to their
    provider's own API, so no model setting can redirect them to another server."""
    env = key_env or PROVIDERS.get(provider, {}).get("key_env")
    if not env:
        return
    if env.startswith("EVALBENCH_") or not KEY_NAME.match(env):
        raise ProviderError(f"'{env}' is not allowed as a key variable: use a name ending in _API_KEY or _TOKEN, such as GROQ_API_KEY")
    hosts = OFFICIAL_KEYS.get(env)
    if hosts and base_url:
        host = (urlparse(base_url).hostname or "").lower()
        if host not in hosts:
            raise ProviderError(f"{env} is only sent to {', '.join(sorted(hosts))}; give this endpoint its own variable, such as GATEWAY_API_KEY")


@dataclass
class Completion:
    text: str
    input_tokens: int | None
    output_tokens: int | None
    latency_ms: int
    finish_reason: str | None


def key_env_for(model: dict) -> str | None:
    return model.get("api_key_env") or PROVIDERS[model["provider"]]["key_env"]


def key_status(model: dict) -> dict:
    env = key_env_for(model)
    return {"env": env, "present": bool(env and os.environ.get(env))} if env else {"env": None, "present": True}


class ProviderPool:
    """Keeps one SDK client per endpoint so connections are reused across a run."""

    def __init__(self) -> None:
        self._clients: dict[tuple, Any] = {}

    def _key(self, model: dict) -> str | None:
        check_key_binding(model["provider"], model.get("base_url"), model.get("api_key_env"))
        env = key_env_for(model)
        if not env:
            return None
        value = os.environ.get(env)
        if not value:
            raise ProviderError(f"{env} is not set in the environment")
        return value

    def client(self, model: dict) -> Any:
        provider = model["provider"]
        if provider not in PROVIDERS:
            raise ProviderError(f"unknown provider {provider!r}")
        params = model.get("params") or {}
        timeout = float(params.get("timeout", 600 if provider != "openai-compatible" else 300))
        key = self._key(model)
        base_url = model.get("base_url") or PROVIDERS[provider]["base_url"]
        cache_key = (provider, base_url, key_env_for(model), key, timeout)
        if cache_key not in self._clients:
            if provider == "anthropic":
                self._clients[cache_key] = anthropic.AsyncAnthropic(
                    api_key=key, base_url=base_url, timeout=timeout, max_retries=3
                )
            else:
                if provider == "openai-compatible" and not base_url:
                    raise ProviderError("an OpenAI-compatible model needs a base URL")
                self._clients[cache_key] = openai.AsyncOpenAI(
                    api_key=key or "not-needed", base_url=base_url, timeout=timeout, max_retries=3
                )
        return self._clients[cache_key]

    async def complete(self, model: dict, system: str | None, prompt: str) -> Completion:
        params = model.get("params") or {}
        provider = model["provider"]
        max_tokens = int(params.get("max_tokens") or PROVIDERS[provider]["max_tokens"])
        client = self.client(model)
        started = time.monotonic()
        try:
            if provider == "anthropic":
                return await self._anthropic(client, model, params, system, prompt, max_tokens, started)
            return await self._openai(client, model, params, system, prompt, max_tokens, started)
        except (anthropic.APIStatusError, openai.APIStatusError) as e:
            raise ProviderError(f"HTTP {e.status_code}: {_message(e)}") from None
        except (anthropic.APITimeoutError, openai.APITimeoutError):
            raise ProviderError("request timed out") from None
        except (anthropic.APIConnectionError, openai.APIConnectionError):
            raise ProviderError(f"could not connect to {model.get('base_url') or provider}") from None

    async def _anthropic(self, client, model, params, system, prompt, max_tokens, started) -> Completion:
        kwargs: dict[str, Any] = {
            "model": model["model"],
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system
        if params.get("effort") in EFFORTS:
            kwargs["output_config"] = {"effort": params["effort"]}
        # Refusals are recorded as refusals: no fallback model is substituted, because the
        # point of a run is to measure the model that was asked.
        resp = await client.messages.create(**kwargs)
        text = "".join(block.text for block in resp.content if block.type == "text")
        return Completion(
            text=text,
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
            latency_ms=int((time.monotonic() - started) * 1000),
            finish_reason=resp.stop_reason,
        )

    async def _openai(self, client, model, params, system, prompt, max_tokens, started) -> Completion:
        messages = ([{"role": "system", "content": system}] if system else []) + [
            {"role": "user", "content": prompt}
        ]
        kwargs: dict[str, Any] = {"model": model["model"], "messages": messages}
        if model["provider"] == "openai":
            kwargs["max_completion_tokens"] = max_tokens
            if params.get("effort") in EFFORTS:
                kwargs["reasoning_effort"] = params["effort"]
        else:
            kwargs["max_tokens"] = max_tokens
        if params.get("temperature") is not None:
            kwargs["temperature"] = float(params["temperature"])
        resp = await client.chat.completions.create(**kwargs)
        if not resp.choices:
            raise ProviderError("the server returned no choices")
        choice = resp.choices[0]
        usage = resp.usage
        return Completion(
            text=visible_answer(choice.message.content or ""),
            input_tokens=getattr(usage, "prompt_tokens", None),
            output_tokens=getattr(usage, "completion_tokens", None),
            latency_ms=int((time.monotonic() - started) * 1000),
            finish_reason=choice.finish_reason,
        )

    async def list_models(self, model: dict) -> list[str]:
        """Model ids the endpoint offers. Free to call, so it doubles as a connection test."""
        client = self.client(model)
        try:
            if model["provider"] == "anthropic":
                ids = [m.id async for m in client.models.list(limit=100)]
            else:
                ids = [m.id async for m in client.models.list()]
        except (anthropic.APIStatusError, openai.APIStatusError) as e:
            raise ProviderError(f"HTTP {e.status_code}: {_message(e)}") from None
        except (anthropic.APIConnectionError, openai.APIConnectionError, anthropic.APITimeoutError, openai.APITimeoutError):
            raise ProviderError(f"could not connect to {model.get('base_url') or model['provider']}") from None
        return sorted(ids)

    async def close(self) -> None:
        for client in self._clients.values():
            await client.close()
        self._clients.clear()


def _message(e: Exception) -> str:
    body = getattr(e, "body", None)
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])[:300]
        if isinstance(err, str):
            return err[:300]
    return str(getattr(e, "message", e))[:300]
