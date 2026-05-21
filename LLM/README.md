# KN-IG LLM Server

기간 종합 보안 리포트를 생성하는 LLM 서버입니다. 관리자가 콘솔에서 리포트 생성을
요청하면 **중앙 Backend**가 누적된 `file_events`/`alerts`/`agents` 데이터를 모아 이
서버로 전달하고, 이 서버는 `Frontend/public/report-demo-v2.html`이 렌더하는 `DATA`
구조(JSON)를 반환합니다.

## 설계 원칙 — 숫자는 코드, 서술은 LLM

- 차트·집계 등 **모든 수치는 `aggregate.py`에서 결정적으로 계산**합니다(환각 방지).
- LLM은 **서술(findings/recs/incident 분석문)만** 작성합니다(Gemini → OpenAI GPT 폴백).
- 두 제공자 모두 실패하거나 키가 없으면 `classify.py` 기반 **템플릿 서술**로 항상
  유효한 리포트를 반환합니다.

경로 분류 지식(`classify.py`)은 `Frontend/public/js/api.js`의 `PATH_PROFILES`를 포팅한 것입니다.

## 구조

```
app/
  main.py        FastAPI: GET /health, POST /v1/reports/summary
  schemas.py     요청/응답(ReportData) Pydantic 모델
  classify.py    경로 → 카테고리/심각도/MITRE, MITRE 용어집
  aggregate.py   결정적 수치 + 템플릿 서술로 스켈레톤 생성
  llm/
    provider.py  Gemini → GPT 폴백
    prompts.py   서술 프롬프트
    narrative.py 호출·JSON 파싱
  assemble.py    스켈레톤 + LLM 서술 병합 + 검증
```

## 실행

```bash
cd LLM
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # GEMINI_API_KEY / OPENAI_API_KEY 입력 (없어도 동작: 템플릿 폴백)
uvicorn app.main:app --port 8088
```

## 엔드포인트

- `GET /health` → `{"status":"ok","llm_provider_configured":bool}`
- `POST /v1/reports/summary` → 요청 본문은 Backend가 보내는
  `{range, agents, events, prevEvents, alerts}`. 응답은 report 페이지 `DATA` JSON.

### 로컬 확인

```bash
curl -s localhost:8088/health
curl -s -X POST localhost:8088/v1/reports/summary \
  -H 'content-type: application/json' \
  --data @sample_request.json | python -m json.tool
```

API 키 없이 실행하면 템플릿 서술로, 키가 있으면 LLM 서술로 채워집니다.

## 테스트

```bash
pip install -r requirements-dev.txt
python -m pytest        # LLM/ 디렉터리에서 실행
```

테스트는 API 키 없이 동작하며(템플릿 폴백 경로), 결정적 집계·분류·스키마 계약을 검증합니다.

## Docker

```bash
docker build -t kn-ig-llm .
docker run --rm -p 8088:8088 \
  -e GEMINI_API_KEY=$GEMINI_API_KEY \
  -e OPENAI_API_KEY=$OPENAI_API_KEY \
  kn-ig-llm
```

Backend는 `LLM_SERVER_URL`(기본 `http://127.0.0.1:8088`)로 이 컨테이너를 가리킵니다.
키를 주지 않아도 템플릿 리포트를 반환하므로 오프라인/망분리 환경에서도 동작합니다.

