# KN-IG LLM Server

기간 종합 보안 리포트 생성 서버. 중앙 Backend가 누적 `file_events`/`alerts`/`agents`를 보내면,
콘솔 Report 탭(`ReportV2`)이 렌더하는 `DATA`(JSON)를 반환합니다.

**원칙 — 숫자는 코드, 서술은 LLM**: 모든 수치는 `aggregate.py`에서 결정적 계산(환각 방지), 서술만 LLM(Gemini→GPT 폴백).
키가 없거나 실패해도 템플릿 서술로 **항상 유효한 리포트**를 반환합니다(오프라인/망분리 안전).

## LLM Provider 운영 가이드

- `PROVIDER_ORDER=gemini,openai`가 기본값이며, 먼저 성공한 provider의 결과를 사용합니다.
- 구조화 JSON patch 안정성이 더 중요하면 `PROVIDER_ORDER=openai,gemini`로 OpenAI를 1순위에 두는 구성이 적합합니다. 본 서버는 `OPENAI_API_KEY`와 `OPENAI_MODEL`만 설정하면 별도 코드 변경 없이 OpenAI를 사용할 수 있습니다.
- 어떤 provider를 쓰더라도 수치·차트·MITRE 매트릭스의 기본 집계는 코드가 만들고, LLM은 검증 가능한 서술/분류 보강만 수행합니다. LLM이 제안한 MITRE ID는 서버 용어집에 존재하는 값만 반영됩니다.

## 구조

```
app/main.py     FastAPI: GET /health, POST /v1/reports/summary
   schemas.py   요청/응답(ReportData) 모델
   classify.py  경로 → 카테고리/심각도/MITRE
   aggregate.py 결정적 수치 + 템플릿 스켈레톤
   assemble.py  스켈레톤 + LLM 서술 병합·검증
   llm/         provider(폴백) · prompts · narrative
```

## 실행

```bash
cd LLM
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # GEMINI_API_KEY / OPENAI_API_KEY (없어도 템플릿 폴백)
uvicorn app.main:app --port 8088
```

## 엔드포인트

- `GET /health` → `{"status":"ok","llm_provider_configured":bool,"provider_order":[...],"configured_providers":[...]}`
- `POST /v1/reports/summary` ← `{range, agents, events, prevEvents, alerts}` → report `DATA` JSON
- `POST /v1/reports/summary/stream` → SSE(`skeleton`/`token`/`patch`/`done`)로 실시간 종합 분석 + 최종 report `DATA`

```bash
curl -s localhost:8088/health
curl -s -X POST localhost:8088/v1/reports/summary \
  -H 'content-type: application/json' --data @sample_request.json | python -m json.tool
```

## 테스트 / Docker

```bash
pip install -r requirements-dev.txt && python -m pytest     # 키 없이 동작(템플릿 폴백)

docker build -t kn-ig-llm . && docker run --rm -p 8088:8088 \
  -e GEMINI_API_KEY=$GEMINI_API_KEY -e OPENAI_API_KEY=$OPENAI_API_KEY kn-ig-llm
```

Backend는 `LLM_SERVER_URL`(기본 `http://127.0.0.1:8088`)로 가리킵니다.
