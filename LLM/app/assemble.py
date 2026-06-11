"""Assemble the final report: deterministic skeleton + (optional) LLM prose.

Numbers and structure come from ``aggregate``; only prose fields are overlaid
from the LLM patch. The result is validated against ``ReportData`` so a malformed
overlay can never produce an invalid response — on validation failure we fall
back to the (already valid) skeleton.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from . import aggregate, classify
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


_SEV_OK = {"Critical", "High", "Medium", "Low"}


def _valid_mitre(ids) -> List[str]:
    """AI가 제안한 기법 ID 중 MITRE 용어집에 존재하는 것만 통과(가짜 ID 차단)."""
    if not isinstance(ids, list):
        return []
    out: List[str] = []
    for t in ids:
        if isinstance(t, str) and t.strip() and (
            classify.MITRE_GLOSSARY.get(t.strip())
            or classify.MITRE_GLOSSARY.get(classify.base_id(t.strip()))
        ):
            out.append(t.strip())
    return out


def _apply_incident_classification(incidents: List[Dict], patch: Optional[list]) -> None:
    """AI 제안 MITRE/심각도를 검증 후 반영 — 가짜 ID·이상 심각도는 룰 값 유지."""
    if not isinstance(patch, list):
        return
    for entry in patch:
        if not isinstance(entry, dict):
            continue
        i = _as_int(entry.get("index"))
        if not (0 <= i < len(incidents)):
            continue
        mitre = _valid_mitre(entry.get("mitre"))
        if mitre:
            incidents[i]["mitre"] = mitre
        sev = entry.get("sev")
        if isinstance(sev, str) and sev in _SEV_OK:
            incidents[i]["sev"] = sev


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
        # AI 주도 분류(검증 통과분만 반영) + 종합 평가(executiveSummary)
        _apply_incident_classification(skeleton["incidents"], patch.get("incidents"))
        es = patch.get("executiveSummary")
        if isinstance(es, str) and es.strip():
            skeleton["executiveSummary"] = es.strip()

    try:
        return ReportData(**skeleton)
    except Exception as exc:  # noqa: BLE001
        log.error("skeleton failed validation: %s", exc)
        raise
