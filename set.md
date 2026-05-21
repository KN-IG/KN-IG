# KN-IG Setup

모든 명령은 `KN-IG` 저장소 루트를 기준으로 작성한다.
로컬 절대 경로는 사용하지 않는다.

## 3. backend 스크립트로 처음부터 세팅

backend 머신에서 실행:

```bash
cd KN-IG
./setup_backend_agent_runtime.sh -m backend -v user@192.168.64.11
```

이 단계에서 자동으로 하는 것:

- MySQL 확인
- `integrityguard` DB 생성
- `integrityguard_app` 계정 생성
- schema 적용
- `Backend/.env` 생성
- backend/server/agent 인증서 생성 또는 재생성
- `Agent/`, 인증서, setup 스크립트 VM 전송

## 4. backend 서버 실행

backend 머신에서 새 터미널:

```bash
cd KN-IG/Backend
go run ./cmd/server
```

정상 기준:

- HTTP 서버 시작: `:8080`
- TCP 서버 시작: `:9000`

## 5. VM에서 agent 쪽 스크립트 세팅

VM에서:

```bash
ssh user@192.168.64.11
cd KN-IG
sudo ./setup_backend_agent_runtime.sh -m agent -c 192.168.64.1
```

이 단계에서 자동으로 하는 것:

- `/etc/ig_monitor/ig.env`
- `/etc/ig_monitor/certs/ca.crt`
- `/etc/ig_monitor/certs/agent.crt`
- `/etc/ig_monitor/certs/agent.key`

## 6. VM에서 eBPF 준비 + build

VM에서:

```bash
cd KN-IG/Agent
sudo ./scripts/setup_ebpf_deps.sh
cmake -S . -B build
cmake --build build
```

## 7. VM에서 service 설치/재시작

VM에서:

```bash
cd KN-IG/Agent
sudo ./scripts/install_agent_service.sh
```

## 8. 최종 확인

backend 머신에서:

```bash
curl -sS http://127.0.0.1:8080/api/agents | jq .
curl -sS 'http://127.0.0.1:8080/api/events?limit=10' | jq .
curl -sS 'http://127.0.0.1:8080/api/alerts?limit=10' | jq .
```

VM에서 이벤트 발생:

```bash
sudo touch /etc/ig_test_ebpf.txt
sudo sh -c 'echo first >> /etc/ig_test_ebpf.txt'
sudo mv /etc/ig_test_ebpf.txt /etc/ig_test_ebpf_renamed.txt
sudo rm -f /etc/ig_test_ebpf_renamed.txt
```

다시 backend 머신:

```bash
curl -sS 'http://127.0.0.1:8080/api/events?limit=10' | jq .
curl -sS 'http://127.0.0.1:8080/api/alerts?limit=10' | jq .
```

## 9. (선택) LLM 리포트 서버

콘솔 Report 탭의 기간 종합 리포트를 실데이터로 생성하려면 LLM 서버를 띄운다.
미가동 시 콘솔은 mock 데이터로 폴백하므로 필수는 아니다.

```bash
cd KN-IG/LLM
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # GEMINI_API_KEY / OPENAI_API_KEY 입력 (없어도 템플릿으로 동작)
uvicorn app.main:app --port 8088
```

backend는 `LLM_SERVER_URL`(기본 `http://127.0.0.1:8088`)로 이 서버를 호출한다.

```bash
curl -sS -X POST 'http://127.0.0.1:8080/api/reports/summary' | jq '.severity, (.incidents|length)'
```

자세한 내용은 `LLM/README.md` 참고.
