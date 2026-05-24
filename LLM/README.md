# KN-IG LLM Server

기간 종합 보안 리포트 생성 서버. 중앙 Backend가 누적 `file_events`/`alerts`/`agents`를 보내면,
콘솔 Report 탭(`ReportV2`)이 렌더하는 `DATA`(JSON)를 반환합니다.

**원칙 — 숫자는 코드, 서술은 LLM**: 모든 수치는 `aggregate.py`에서 결정적 계산(환각 방지), 서술만 LLM(Gemini→GPT 폴백).
키가 없거나 실패해도 템플릿 서술로 **항상 유효한 리포트**를 반환합니다(오프라인/망분리 안전).

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

- `GET /health` → `{"status":"ok","llm_provider_configured":bool}`
- `POST /v1/reports/summary` ← `{range, agents, events, prevEvents, alerts}` → report `DATA` JSON

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
