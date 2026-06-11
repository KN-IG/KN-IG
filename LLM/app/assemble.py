"""Assemble the final report: deterministic skeleton + (optional) LLM prose.

Numbers and structure come from ``aggregate``; only prose fields are overlaid
from the LLM patch. The result is validated against ``ReportData`` so a malformed
overlay can never produce an invalid response — on validation failure we fall
back to the (already valid) skeleton.
"""

from __future__ import annotations

import logging
from typing import Dict, Iterable, List, Optional

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


def _dedupe(items: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for item in items:
        if item and item not in seen:
            out.append(item)
            seen.add(item)
    return out


def _kill_for(mitre: List[str]) -> List[int]:
    kill = sorted({classify.tactic_of(t)[2] for t in mitre if isinstance(t, str)})
    return kill or [0]


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
            # AI가 근거 있는 기법을 추가할 수는 있지만, 경로/PID Chain에서 결정론적으로
            # 잡힌 기법을 누락시키지는 않는다. 그래야 사건 카드·매트릭스가 증거를 잃지 않는다.
            incidents[i]["mitre"] = _dedupe([*incidents[i].get("mitre", []), *mitre])
            incidents[i]["kill"] = _kill_for(incidents[i]["mitre"])
        sev = entry.get("sev")
        if isinstance(sev, str) and sev in _SEV_OK:
            incidents[i]["sev"] = sev


def _reconcile_mitre(skeleton: Dict) -> None:
    """AI가 사건에 부여한 기법이 ATT&CK 매트릭스·용어집에서 누락되지 않게 보강.
    리포트 내부 일관성(사건 카드 ↔ 매트릭스 ↔ 용어집) 확보 — AI가 새로 도입한 기법만
    해당 전술 컬럼/용어집에 추가하고, 기존 수치(코드 집계값)는 그대로 둔다."""
    inc_tech: Dict[str, int] = {}
    for inc in skeleton.get("incidents", []):
        for t in inc.get("mitre", []):
            if isinstance(t, str) and t:
                inc_tech[t] = inc_tech.get(t, 0) + 1
    if not inc_tech:
        return

    # 용어집 보강 (없는 기법 추가)
    glossary = skeleton.setdefault("mitreGlossary", [])
    seen = {row[0] for row in glossary if row}
    for t in inc_tech:
        if t in seen:
            continue
        meta = classify.MITRE_GLOSSARY.get(t) or classify.MITRE_GLOSSARY.get(classify.base_id(t))
        if meta:
            glossary.append([t, meta[0], meta[1]])
            seen.add(t)
    glossary.sort(key=lambda row: row[0])

    # 매트릭스 보강 (없는 기법을 해당 전술 컬럼에 추가)
    matrix = skeleton.setdefault("attackMatrix", [])
    col_by_tactic = {col["tactic"]: col for col in matrix}
    existing = {tech["id"] for col in matrix for tech in col["tech"]}
    for t, n in inc_tech.items():
        if t in existing:
            continue
        tac_ko, tac_en, _ = classify.tactic_of(t)
        col = col_by_tactic.get(tac_ko)
        if col is None:
            col = {"tactic": tac_ko, "en": tac_en, "tech": []}
            matrix.append(col)
            col_by_tactic[tac_ko] = col
        col["tech"].append({"id": t, "nm": classify.tech_name(t), "n": n})
        existing.add(t)
    # 표준 전술 순서 + 컬럼 내 빈도 내림차순 (aggregate 컨벤션 유지)
    order = {ko: i for i, (ko, _en) in enumerate(classify.TACTIC_ORDER)}
    matrix.sort(key=lambda col: order.get(col["tactic"], 999))
    for col in matrix:
        col["tech"].sort(key=lambda tech: tech["n"], reverse=True)


def apply_patch(skeleton: Dict, patch: Optional[Dict]) -> Dict:
    """LLM patch를 검증된 필드에만 반영하고 내부 일관성을 재조정한다."""
    if not patch:
        return skeleton

    _overlay(skeleton["findings"], patch.get("findings"), ["tag", "title", "body"])
    _overlay(skeleton["recs"], patch.get("recs"), ["title", "body", "link"])
    _overlay(skeleton["incidents"], patch.get("incidents"), ["desc", "detail", "finding"])
    _apply_incident_classification(skeleton["incidents"], patch.get("incidents"))
    _reconcile_mitre(skeleton)
    es = patch.get("executiveSummary")
    if isinstance(es, str) and es.strip():
        skeleton["executiveSummary"] = es.strip()
    return skeleton


def build_report(req: ReportRequest) -> ReportData:
    skeleton = aggregate.build_skeleton(req)

    patch = None
    try:
        patch = narrative.generate(skeleton)
    except Exception as exc:  # noqa: BLE001 — narrative must never break the response
        log.warning("narrative generation raised: %s", exc)

    apply_patch(skeleton, patch)

    try:
        return ReportData(**skeleton)
    except Exception as exc:  # noqa: BLE001
        log.error("skeleton failed validation: %s", exc)
        raise
