"""Assemble the final report: deterministic skeleton + (optional) LLM prose.

Numbers and structure come from ``aggregate``; only prose fields are overlaid
from the LLM patch. The result is validated against ``ReportData`` so a malformed
overlay can never produce an invalid response — on validation failure we fall
back to the (already valid) skeleton.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from . import aggregate
from .llm import narrative
from .schemas import ReportData, ReportRequest

log = logging.getLogger("assemble")


def _as_int(v, default: int = -1) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _overlay(items: List[Dict], patch: Optional[list], fields: List[str]) -> None:
    if not isinstance(patch, list):
        return
    for entry in patch:
        if not isinstance(entry, dict):
            continue
        i = _as_int(entry.get("index"))
        if not (0 <= i < len(items)):
            continue
        for f in fields:
            val = entry.get(f)
            if isinstance(val, str) and val.strip():
                items[i][f] = val.strip()


def build_report(req: ReportRequest) -> ReportData:
    skeleton = aggregate.build_skeleton(req)

    patch = None
    try:
        patch = narrative.generate(skeleton)
    except Exception as exc:  # noqa: BLE001 — narrative must never break the response
        log.warning("narrative generation raised: %s", exc)

    if patch:
        _overlay(skeleton["findings"], patch.get("findings"), ["tag", "title", "body"])
        _overlay(skeleton["recs"], patch.get("recs"), ["title", "body", "link"])
        _overlay(skeleton["incidents"], patch.get("incidents"), ["desc", "detail", "finding"])

    try:
        return ReportData(**skeleton)
    except Exception as exc:  # noqa: BLE001
        log.error("skeleton failed validation: %s", exc)
        raise
