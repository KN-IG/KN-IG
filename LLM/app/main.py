"""KN-IG LLM Server — FastAPI entrypoint.

Produces the period-summary report DATA (the ReportData contract rendered by
the console's ReportV2 component) from the raw events/alerts/agents that the
Go backend forwards. Numbers are computed deterministically; an LLM (Gemini ->
GPT fallback) writes the narrative; on any LLM failure a valid template report
is still returned.
"""

from __future__ import annotations

import json
import logging

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

from . import aggregate, assemble
from .llm import narrative, provider
from .llm.prompts import build_narrative_prompt
from .schemas import ReportData, ReportRequest

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="KN-IG LLM Server", version="1.0.0")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "llm_provider_configured": provider.available(),
        "provider_order": provider.order(),
        "configured_providers": provider.configured(),
    }


@app.post("/v1/reports/summary", response_model=ReportData)
def generate_summary(req: ReportRequest) -> ReportData:
    return assemble.build_report(req)


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.post("/v1/reports/summary/stream")
def generate_summary_stream(req: ReportRequest) -> StreamingResponse:
    """SSE 스트리밍 리포트 생성.

    이벤트 순서:
      skeleton — 결정론적 구조/숫자(차트·KPI·매트릭스·사건 템플릿). 즉시 1회.
      token    — LLM '종합 분석' 내러티브 토큰(자유 텍스트). 0..N회.
      patch    — JSON 패치(findings/recs/incidents 서술 정교화) + 내러티브 적용한 최종 ReportData.
      done     — 종료 신호.
    """
    log = logging.getLogger("stream")

    def gen():
        skeleton = aggregate.build_skeleton(req)
        yield _sse("skeleton", skeleton)

        # 1) 내러티브 토큰 스트리밍(자유 텍스트)
        parts: list[str] = []
        try:
            for tok in provider.generate_stream(build_narrative_prompt(skeleton)):
                parts.append(tok)
                yield _sse("token", {"t": tok})
        except Exception as exc:  # noqa: BLE001 — 스트림 실패해도 리포트는 완성
            log.warning("narrative stream failed: %s", exc)

        # 2) 구조화 JSON 패치(비스트림) 적용
        try:
            patch = narrative.generate(skeleton)
            if patch:
                assemble.apply_patch(skeleton, patch)
        except Exception as exc:  # noqa: BLE001
            log.warning("json patch failed: %s", exc)

        if parts:
            skeleton["executiveSummary"] = "".join(parts).strip()

        # 3) 최종 ReportData(검증 통과분만 전송)
        try:
            yield _sse("patch", ReportData(**skeleton).model_dump())
        except Exception as exc:  # noqa: BLE001
            log.error("final validation failed: %s", exc)

        yield _sse("done", {})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
