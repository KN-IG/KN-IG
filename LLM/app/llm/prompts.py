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
                "심각도": inc["sev"],
                "경로": inc["path"],
                "호스트": inc["host"],
                "시각": inc["time"],
                "유형": inc["type"],
                "MITRE": inc["mitre"],
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
            {"index": "사건 index와 일치", "desc": "한 줄 요약", "detail": "2~3문장 분석", "finding": "핵심 발견 한 문장"}
        ],
        "executiveSummary": "비전문가용 2~3문장 총평",
    }

    return (
        "당신은 OT/ICS 보안 관제 분석가입니다. 아래 '사실'은 무결성 가드가 수집·집계한 확정 데이터입니다.\n"
        "이 데이터를 바탕으로 비전문가 관리자가 이해할 수 있는 한국어 서술(prose)만 작성하세요.\n\n"
        "규칙:\n"
        "1) 숫자/통계는 절대 새로 만들지 말고 주어진 값만 인용합니다.\n"
        "2) findings/recs/incidents 배열의 항목 수와 순서(index)는 입력과 정확히 동일하게 유지합니다.\n"
        "3) 과장 없이 사실 기반으로, 운영자가 바로 행동할 수 있게 구체적으로 씁니다.\n"
        "4) 반드시 아래 JSON 스키마 형태의 단일 JSON 객체만 출력합니다(코드펜스·설명 금지).\n\n"
        f"[사실]\n{json.dumps(facts, ensure_ascii=False)}\n\n"
        f"[출력 JSON 스키마]\n{json.dumps(schema, ensure_ascii=False)}\n"
    )
