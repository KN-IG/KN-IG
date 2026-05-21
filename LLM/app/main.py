"""KN-IG LLM Server — FastAPI entrypoint.

Produces the period-summary report DATA (the contract rendered by
Frontend/public/report-demo-v2.html) from the raw events/alerts/agents that the
Go backend forwards. Numbers are computed deterministically; an LLM (Gemini ->
GPT fallback) writes the narrative; on any LLM failure a valid template report
is still returned.
"""

from __future__ import annotations

import logging

from dotenv import load_dotenv
from fastapi import FastAPI

from . import assemble
from .llm import provider
from .schemas import ReportData, ReportRequest

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="KN-IG LLM Server", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok", "llm_provider_configured": provider.available()}


@app.post("/v1/reports/summary", response_model=ReportData)
def generate_summary(req: ReportRequest) -> ReportData:
    return assemble.build_report(req)
