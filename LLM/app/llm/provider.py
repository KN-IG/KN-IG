"""LLM provider abstraction with Gemini -> OpenAI GPT fallback.

Each provider is tried in ``PROVIDER_ORDER``. A provider is skipped when its API
key or SDK is missing. ``generate`` returns the raw model text, or ``None`` when
every configured provider fails — callers must treat ``None`` as "fall back to
the deterministic template".
"""

from __future__ import annotations

import logging
import os
from typing import Iterator, List, Optional

log = logging.getLogger("llm.provider")


def _order() -> List[str]:
    raw = os.getenv("PROVIDER_ORDER", "gemini,openai")
    return [p.strip().lower() for p in raw.split(",") if p.strip()]


def _gemini(prompt: str) -> Optional[str]:
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        return None
    try:
        import google.generativeai as genai
    except ImportError:
        log.warning("google-generativeai not installed; skipping gemini")
        return None
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    # REST transport (not gRPC): fails fast on errors instead of retrying
    # forever, and honours the system/requests CA bundle — more compatible with
    # TLS-inspecting corporate proxies.
    genai.configure(api_key=key, transport="rest")
    gm = genai.GenerativeModel(
        model,
        generation_config={"response_mime_type": "application/json", "temperature": 0.4},
    )
    resp = gm.generate_content(prompt, request_options={"timeout": 45})
    return (resp.text or "").strip() or None


def _openai(prompt: str) -> Optional[str]:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        return None
    try:
        from openai import OpenAI
    except ImportError:
        log.warning("openai not installed; skipping openai")
        return None
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    client = OpenAI(api_key=key, timeout=45.0)
    resp = client.chat.completions.create(
        model=model,
        temperature=0.4,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": "You are a Korean SOC analyst. Reply with a single JSON object only."},
            {"role": "user", "content": prompt},
        ],
    )
    return (resp.choices[0].message.content or "").strip() or None


_PROVIDERS = {"gemini": _gemini, "openai": _openai}


def generate(prompt: str) -> Optional[str]:
    for name in _order():
        fn = _PROVIDERS.get(name)
        if fn is None:
            continue
        try:
            text = fn(prompt)
            if text:
                log.info("narrative generated via %s", name)
                return text
        except Exception as exc:  # noqa: BLE001 — any provider error → next provider
            log.warning("provider %s failed: %s", name, exc)
    return None


def available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY") or os.getenv("OPENAI_API_KEY"))


# ──────────────────────────── streaming (free prose) ────────────────────────
# 자유 텍스트 내러티브 토큰 스트리밍. JSON 패치 경로(generate)와 분리 —
# 여기서는 response_mime_type=json 제약을 걸지 않는다(순수 서술 텍스트).


def _gemini_stream(prompt: str) -> Optional[Iterator[str]]:
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        return None
    try:
        import google.generativeai as genai
    except ImportError:
        log.warning("google-generativeai not installed; skipping gemini")
        return None
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    genai.configure(api_key=key, transport="rest")
    gm = genai.GenerativeModel(model, generation_config={"temperature": 0.5})

    def _it() -> Iterator[str]:
        resp = gm.generate_content(prompt, stream=True, request_options={"timeout": 60})
        for chunk in resp:
            text = getattr(chunk, "text", "") or ""
            if text:
                yield text

    return _it()


def _openai_stream(prompt: str) -> Optional[Iterator[str]]:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        return None
    try:
        from openai import OpenAI
    except ImportError:
        log.warning("openai not installed; skipping openai")
        return None
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    client = OpenAI(api_key=key, timeout=60.0)

    def _it() -> Iterator[str]:
        stream = client.chat.completions.create(
            model=model,
            temperature=0.5,
            stream=True,
            messages=[
                {"role": "system", "content": "You are a Korean SOC analyst. Write clear Korean prose."},
                {"role": "user", "content": prompt},
            ],
        )
        for ev in stream:
            delta = (ev.choices[0].delta.content or "") if ev.choices else ""
            if delta:
                yield delta

    return _it()


_STREAMERS = {"gemini": _gemini_stream, "openai": _openai_stream}


def generate_stream(prompt: str) -> Iterator[str]:
    """첫 토큰을 내는 provider로 확정 후 끝까지 스트리밍. 모두 실패하면 빈 스트림."""
    for name in _order():
        fn = _STREAMERS.get(name)
        if fn is None:
            continue
        gen = fn(prompt)
        if gen is None:
            continue  # 키/SDK 없음
        try:
            first = next(gen)
        except StopIteration:
            continue  # 토큰 없이 끝남 → 다음 provider
        except Exception as exc:  # noqa: BLE001 — provider 오류 → 다음 provider
            log.warning("stream provider %s failed: %s", name, exc)
            continue
        log.info("narrative streamed via %s", name)
        yield first
        yield from gen
        return
    log.info("no streaming provider produced output")
