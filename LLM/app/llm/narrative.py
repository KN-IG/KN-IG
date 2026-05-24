"""Narrative pass: call a provider, parse its JSON, return a prose patch.

Returns ``None`` on any failure (no key, provider error, unparseable output) so
that ``assemble`` keeps the deterministic template prose.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Dict, Optional

from . import provider
from .prompts import build_prompt

log = logging.getLogger("llm.narrative")


def _extract_json(text: str) -> Optional[dict]:
    text = text.strip()
    # tolerate ```json fences if a model adds them despite instructions
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if 0 <= start < end:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return None
    return None


def generate(skeleton: Dict) -> Optional[Dict]:
    if not provider.available():
        log.info("no provider key set; using template prose")
        return None
    raw = provider.generate(build_prompt(skeleton))
    if not raw:
        return None
    patch = _extract_json(raw)
    if patch is None:
        log.warning("could not parse provider JSON; using template prose")
        return None
    return patch
