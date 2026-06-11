"""Prompt construction for the narrative pass.

The LLM is given the *already-computed* aggregates and incident facts and is
asked to write only the prose fields. It must not change any number — numbers
come from ``aggregate``. Output is a strict JSON object so it can be parsed and
overlaid deterministically.
"""

from __future__ import annotations

import json
from typing import Dict


def build_prompt(skeleton: Dict) -> str:
    facts = {
        "기간": skeleton["days"],
        "심각도_합계": skeleton["severity"],
        "전체_이벤트": skeleton["kpis"][0]["num"],
        "차단율": skeleton["kpis"][1]["sub"],
        "미차단_확인필요": skeleton["kpis"][2]["num"],
        "치명적_표적": skeleton["kpis"][3]["num"],
        "표적_자산_상위": [[c[0], c[1]] for c in skeleton["category"]],
        "호스트별": [[h[0], h[1], h[2]] for h in skeleton["hosts"]],
        "ATTACK_기법": [
            {"전술": col["tactic"], "기법": [[t["id"], t["nm"], t["n"]] for t in col["tech"]]}
            for col in skeleton["attackMatrix"]
        ],
        "사건": [
            {
                "index": i,
                "심각도_룰제안": inc["sev"],
                "경로": inc["path"],
                "호스트": inc["host"],
                "시각": inc["time"],
                "유형": inc["type"],
                "MITRE_룰제안": inc["mitre"],
                "프로세스_계보": [
                    f"{n.get('name')}(pid {n.get('pid')}, {n.get('user', '')})"
                    + (" [권한상승]" if n.get("esc") else "")
                    + (" [차단]" if n.get("blocked") else "")
                    for n in inc.get("chain", [])
                ],
            }
            for i, inc in enumerate(skeleton["incidents"])
        ],
    }

    schema = {
        "findings": [
            {"index": "0..2 (skeleton 순서 유지)", "tag": "짧은 배지", "title": "제목", "body": "2~3문장"}
        ],
        "recs": [
            {"index": "0..3 (skeleton 순서 유지)", "title": "제목", "body": "1~2문장", "link": "관련 항목"}
        ],
        "incidents": [
            {
                "index": "사건 index와 일치",
                "desc": "한 줄 요약",
                "detail": "2~3문장 분석 — 프로세스 계보·권한 상승 흐름을 근거로",
                "finding": "핵심 발견 한 문장",
                "mitre": ["해당 MITRE 기법 ID 배열 (표준 ID만, 예: T1003.008)"],
                "sev": "Critical|High|Medium|Low 중 하나",
            }
        ],
        "executiveSummary": "비전문가용 2~3문장 총평",
    }

    return (
        "당신은 OT/ICS 보안 관제 분석가입니다. 아래 '사실'은 무결성 가드가 수집·집계한 확정 데이터입니다.\n"
        "이 데이터를 바탕으로 비전문가 관리자가 이해할 수 있는 한국어 서술과 사건 분류를 작성하세요.\n\n"
        "규칙:\n"
        "1) 기간 합계·차트·KPI 등 통계 수치는 새로 만들지 말고 주어진 값만 인용합니다.\n"
        "2) findings/recs/incidents 배열의 항목 수와 순서(index)는 입력과 정확히 동일하게 유지합니다.\n"
        "3) 각 사건의 MITRE 기법과 심각도(sev)는 경로·유형·프로세스 계보를 근거로 직접 판단해 제시합니다. "
        "표준 MITRE 기법 ID만 쓰고(존재하지 않는 ID 금지), 확신이 없으면 룰제안 값을 그대로 유지합니다.\n"
        "4) incidents의 detail은 프로세스 계보(부모-자식 관계, 권한 상승 uid→euid, 차단 지점)를 구체적으로 인용해 공격 흐름을 설명합니다.\n"
        "5) 과장 없이 사실 기반으로, 운영자가 바로 행동할 수 있게 구체적으로 씁니다.\n"
        "6) 반드시 아래 JSON 스키마 형태의 단일 JSON 객체만 출력합니다(코드펜스·설명 금지).\n\n"
        f"[사실]\n{json.dumps(facts, ensure_ascii=False)}\n\n"
        f"[출력 JSON 스키마]\n{json.dumps(schema, ensure_ascii=False)}\n"
    )


def build_narrative_prompt(skeleton: Dict) -> str:
    """스트리밍용 자유 텍스트 '종합 분석' 프롬프트(JSON 아님)."""
    facts = {
        "기간": skeleton["days"],
        "심각도_합계": skeleton["severity"],
        "전체_이벤트": skeleton["kpis"][0]["num"],
        "차단율": skeleton["kpis"][1]["sub"],
        "미차단_확인필요": skeleton["kpis"][2]["num"],
        "치명적_표적": skeleton["kpis"][3]["num"],
        "표적_자산_상위": [[c[0], c[1]] for c in skeleton["category"]],
        "호스트별": [[h[0], h[1], h[2]] for h in skeleton["hosts"]],
        "ATTACK_기법": [
            {"전술": col["tactic"], "기법": [[t["id"], t["nm"], t["n"]] for t in col["tech"]]}
            for col in skeleton["attackMatrix"]
        ],
        "주요_사건": [
            {"심각도": inc["sev"], "경로": inc["path"], "호스트": inc["host"], "유형": inc["type"], "MITRE": inc["mitre"]}
            for inc in skeleton["incidents"]
        ],
    }
    return (
        "당신은 OT/ICS 보안 관제 분석가입니다. 아래 '사실'은 무결성 가드가 수집·집계한 확정 데이터입니다.\n"
        "이 데이터를 바탕으로 비전문가 경영진도 이해할 수 있는 '종합 분석'을 한국어 합니다체로 작성하세요.\n\n"
        "작성 지침:\n"
        "1) 4~6개 문단. 각 문단 앞에 '## 소제목'(마크다운 H2)을 붙입니다.\n"
        "2) 숫자/통계는 주어진 값만 인용하고 새로 만들지 않습니다.\n"
        "3) 위험의 의미 → 공격 흐름(MITRE 전술 연결) → 우선 조치 순으로 서술합니다.\n"
        "4) 과장 없이 사실 기반으로, 담당자가 바로 행동할 수 있게 구체적으로 씁니다.\n"
        "5) JSON·코드펜스 없이 순수 마크다운 서술 텍스트만 출력합니다.\n\n"
        f"[사실]\n{json.dumps(facts, ensure_ascii=False)}\n"
    )
