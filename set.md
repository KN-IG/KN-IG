# KN-IG Setup

- Backend: `.env` 자동 로드, HTTP API, Agent TCP mTLS, XOR enrollment server
- Agent: 인증서가 있으면 기존 mTLS 연결, 인증서가 없으면 `agent --enroll`로 XOR enrollment 수행
- 인증서 재발급: Agent cert/key를 백업/삭제한 뒤 XOR enrollment 재수행

Agent config   : `/etc/ig_monitor/ig.conf`
Agent env      : `/etc/ig_monitor/ig.env`
Agent cert dir : `/etc/ig_monitor/certs`

`Backend/.env`와 `/etc/ig_monitor/ig.env`의 host/port를 맞추기

## 1. Backend `.env`

`Backend/.env`가 있으면 Backend는 자동으로 읽음
`KNIG_ENV_FILE`을 지정하면 해당 파일을 우선 사용

예시:

```dotenv
DATABASE_URL=<db_user>:<db_password>@tcp(127.0.0.1:3306)/fileguard?parseTime=true

HTTP_ADDR=:8080
TCP_ADDR=:9001

TLS_CA=../certs/ca.crt
TLS_CERT=../certs/server.crt
TLS_KEY=../certs/server.key

ENROLL_ADDR=:9443
AGENT_CA_CERT=../certs/ca.crt
AGENT_CA_KEY=../certs/generated-legacy/ca.key
AGENT_CERT_TTL_HOURS=8760

ENROLL_SECRET_PEPPER=<openssl-rand-base64-32-output>
ENROLL_KEY_KEK=<openssl-rand-base64-32-output>
```

주의:

- `ENROLL_SECRET_PEPPER`가 없거나 32자 미만이면 `enroll-token` 발급과 Backend 기동이 실패한다.
- `ENROLL_KEY_KEK`는 DB에 저장되는 XOR key ciphertext 암호화용이다. 표준 base64로 decode했을 때 정확히 32바이트여야 한다.
- 두 값 모두 placeholder(`change-me`, `example`, `<...>` 등)는 거부된다.
- 생성 예시: `openssl rand -base64 32`
- `TLS_CA`, `TLS_CERT`, `TLS_KEY`는 mTLS TCP 서버용
- `AGENT_CA_CERT`, `AGENT_CA_KEY`는 enrollment 시 Agent 인증서를 서명하는 CA

## 2. DB schema / migration

초기 schema:

```bash
mysql -h 127.0.0.1 -u <db_user> -p <db_name> \
  < Backend/internal/store/schema.sql
```

XOR enrollment 테이블/컬럼 migration:

```bash
mysql -h 127.0.0.1 -u <db_user> -p <db_name> \
  < Backend/internal/store/migrations/20260518_xor_enrollment.sql
```

FILE_EVENT payload 확장 migration:

```bash
mysql -h 127.0.0.1 -u <db_user> -p <db_name> \
  < Backend/internal/store/migrations/20260518_file_event_payload.sql
```

인증서 rotation migration:

```bash
mysql -h 127.0.0.1 -u <db_user> -p <db_name> \
  < Backend/internal/store/migrations/20260521_agent_certificate_rotation.sql
```

rotation migration이 필요한 이유:

- 같은 Agent identity는 `spiffe://kn-ig/agent/<agent_id>`를 계속 사용함
- 재발급 시 `cert_subject_hash`는 이전 cert와 같을 수 있음
- `cert_subject_hash`가 unique이면 재발급 insert가 막힘(주의)
- 현재 정책은 `cert_fingerprint`만 unique로 유지하고, 기존 active cert는 `revoked`, 새 cert는 `active`로 둔다.

확인:

```bash
mysql -h 127.0.0.1 -u <db_user> -p <db_name> -e \
  "SHOW INDEX FROM agent_certificates;"
```

정상 기준:

- `uq_agent_cert_fingerprint`는 unique
- `idx_agent_cert_subject_hash`는 non-unique
- `uq_agent_cert_subject_hash`는 없어야 한다

## 3. Backend 실행

```bash
cd Backend
go run ./cmd/server
```

## 4. Agent 서버 접속 / 빌드

Agent 빌드:

```bash
cd /home/user/Agent
cmake -S . -B build
cmake --build build -j"$(nproc)"
```

## 5. Agent 설정

Agent 서버의 `/etc/ig_monitor/ig.env` 예시:

```dotenv
IG_SERVER_HOST=192.168.64.1
IG_SERVER_PORT=9001
IG_CA_CRT=/etc/ig_monitor/certs/ca.crt
IG_AGENT_CRT=/etc/ig_monitor/certs/agent.crt
IG_AGENT_KEY=/etc/ig_monitor/certs/agent.key

IG_ENROLL_HOST=192.168.64.1
IG_ENROLL_PORT=9443
IG_ENROLL_MONITOR_TYPE=ebpf
```

권한:

```bash
sudo chown -R root:root /etc/ig_monitor
sudo chmod 640 /etc/ig_monitor/ig.env /etc/ig_monitor/ig.conf
sudo chmod 644 /etc/ig_monitor/certs/ca.crt
[ -f /etc/ig_monitor/certs/agent.crt ] && sudo chmod 644 /etc/ig_monitor/certs/agent.crt || true
[ -f /etc/ig_monitor/certs/agent.key ] && sudo chmod 600 /etc/ig_monitor/certs/agent.key || true
```

Agent 서버의 `/etc/ig_monitor/ig.conf` 최소 예시:

```ini
daemonize = 0
log_file = /dev/stderr
syslog = 0
verbose = 1
ebpf = 1

[watch]
/home/user/ig_test = recursive

[protect]
/home/user/Agent/build/agent = file
```

감시 디렉터리 준비:

```bash
mkdir -p /home/user/ig_test
```

## 6. 최초 XOR enrollment

Backend에서 Agent용 token 발급:

```bash
cd Backend
go run ./cmd/enroll-token -agent-id <agent_id> -ttl-hours 24
```

출력 예시:

```text
ENROLLMENT_ID=<enrollment_id>
XOR_KEY=<xor_key>
EXPIRES_AT=2026-05-20T18:47:41Z
```

`-agent-id`는 필수다. 해당 agent_id로만 enrollment가 가능하다.
Agent ID는 Backend/Agent가 `hostname + IP`로 계산한 값이다.
개발/테스트에서만 unbound token이 필요하면 `-allow-unbound`를 명시한다.

Agent에 인증서가 없는 상태에서 Agent 서버에서 실행:

```bash
sudo -v
printf '%s\n%s\n' '<enrollment_id>' '<xor_key>' | \
  sudo /home/user/Agent/build/agent --enroll -e /etc/ig_monitor/ig.env
```

정상 출력:

```text
Enrollment ID: XOR Key:
agent: enrollment complete. certificate files saved.
```

저장되는 파일:

```text
/etc/ig_monitor/certs/ca.crt
/etc/ig_monitor/certs/agent.crt
/etc/ig_monitor/certs/agent.key
```

중요:

- `Enrollment ID`와 `XOR Key`는 파일/env에 저장하지 않음

## 7. 기존 인증서가 있는 Agent

현재 Agent 동작:

- `agent.crt`, `agent.key`가 있으면 기존 인증서로 mTLS 연결
- 기존 인증서가 Backend DB의 active 인증서 fingerprint와 일치하면 XOR enrollment는 필요 없음
- 인증서가 있는 상태에서 `agent --enroll`을 실행하면 거부 됨
- 즉, 기존 인증서를 자동 삭제하거나 자동 덮어쓰지 않음

XOR enrollment가 필요한 경우:

- Agent에 `agent.crt` 또는 `agent.key`가 없음
- 기존 인증서가 분실/만료/폐기되어 재발급해야 해야함
- Backend DB의 active 인증서 fingerprint와 Agent 인증서가 달라 `agent certificate mismatch`가 발생
- 운영 정책상 물리 전달된 새 XOR key로 Agent를 재인증하고 cert/key를 rotation해야 함

재발급 절차:

기존 key 백업/삭제

그 다음 Backend에서 새 token 발급:

```bash
cd Backend
go run ./cmd/enroll-token -agent-id <agent_id> -ttl-hours 1
```

Agent 서버에서 enrollment 재수행:

```bash
sudo -v
printf '%s\n%s\n' '<enrollment_id>' '<xor_key>' | \
  sudo /home/user/Agent/build/agent --enroll -e /etc/ig_monitor/ig.env
```

Backend DB 처리:

- 기존 active cert row를 `revoked`로 변경
- 새 cert row를 `active`로 insert
- cert row를 삭제하지 않는다

확인:

```bash
mysql -h 127.0.0.1 -u <db_user> -p <db_name> -e \
  "SELECT id, agent_id, status, LEFT(cert_fingerprint,16) AS fp, bound_at, revoked_at FROM agent_certificates ORDER BY id;"
```

정상 예시:

```text
id  agent_id    status   fp                bound_at             revoked_at
1   3343830432  revoked  c60c9e87c15850d1  ...                  ...
2   3343830432  active   36a2cd59a50ba7e6  ...                  NULL
```

## 8. Agent mTLS 연결

foreground 실행:

```bash
sudo /home/user/Agent/build/agent -f -v \
  -c /etc/ig_monitor/ig.conf \
  -e /etc/ig_monitor/ig.env
```

`IG_SERVER_HOST`, `IG_SERVER_PORT`, `IG_CA_CRT`, `IG_AGENT_CRT`, `IG_AGENT_KEY`는 `/etc/ig_monitor/ig.env`에서 읽음
명령 앞에 붙인 환경변수는 env 파일 값을 일시적으로 override할 때만 사용한다.

정상 로그:

```text
tls: TLS 핸드셰이크 성공
ig-tcp: 서버 연결 성공 192.168.64.1:9001
ig-tcp: 등록 완료 (agent_id=<agent_id>)
[transport] 등록 완료
```

백그라운드/운영 실행은 systemd 사용
서비스 unit은 `/etc/ig_monitor/ig.env`를 `EnvironmentFile`로 읽고, Agent는 `/etc/ig_monitor/ig.conf`를 사용

```bash
sudo install -m 0755 /home/user/Agent/build/agent /usr/local/bin/agent
sudo install -m 0644 /home/user/Agent/integrityguard.service /etc/systemd/system/integrityguard.service
sudo systemctl daemon-reload
sudo systemctl enable --now integrityguard.service
sudo systemctl status integrityguard.service --no-pager
```

종료:

```bash
sudo systemctl stop integrityguard.service
```

로그 확인:

```bash
sudo journalctl -u integrityguard.service -n 100 --no-pager
sudo journalctl -u integrityguard.service -f
```

## 9. API 인증

`/api/*`는 PIN Bearer token이 필요함 없으면 401
토큰 없이 호출하면 `401 missing bearer token`이 정상

상태 확인:

```bash
curl -sS http://127.0.0.1:8080/auth/status
```

초기 PIN 설정:

```bash
curl -sS -X POST http://127.0.0.1:8080/auth/setup \
  -H 'Content-Type: application/json' \
  -d '{"pin":"1234"}'
```

로그인:

```bash
TOKEN=$(curl -sS -X POST http://127.0.0.1:8080/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"pin":"1234"}' | jq -r '.token')
```

Agent 조회:

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8080/api/agents | jq .
```

이벤트 조회:

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:8080/api/events?limit=5' | jq .
```

알림 조회:

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:8080/api/alerts?limit=5' | jq .
```

## 10. 이벤트 발생 검증

Agent 서버에서 보호 경로 조작:

```bash
sudo chmod 701 /home/user/ig_test 2>&1 || true
sleep 2
sudo journalctl -u integrityguard.service -n 20 --no-pager
```

정상 Agent 로그:

```text
[ALERT] [ebpf] DENY ATTR hook=path_chmod path=/home/user/ig_test ...
```

Backend API 확인:

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:8080/api/events?limit=5' | jq .
```

정상 JSON 예시:

```json
{
  "AgentID": "3343830432",
  "EventType": "ATTRIB",
  "FilePath": "/home/user/ig_test",
  "DetectedBy": "ebpf",
  "Blocked": true,
  "ActorComm": "chmod"
}
```

## 11. 주요 DB 확인 명령

Agent:

```bash
mysql -h 127.0.0.1 -u <db_user> -p <db_name> -e \
  "SELECT agent_id, hostname, ip, status, last_seen FROM agents;"
```

인증서:

```bash
mysql -h 127.0.0.1 -u <db_user> -p <db_name> -e \
  "SELECT id, agent_id, status, LEFT(cert_fingerprint,16) AS fp, bound_at, revoked_at FROM agent_certificates ORDER BY id;"
```

Enrollment:

```bash
mysql -h 127.0.0.1 -u <db_user> -p <db_name> -e \
  "SELECT enrollment_id, agent_id, status, issued_at, used_at, attempt_count, expires_at FROM agent_enrollments ORDER BY created_at DESC LIMIT 5;"
```

Event:

```bash
mysql -h 127.0.0.1 -u <db_user> -p <db_name> -e \
  "SELECT id, agent_id, event_type, file_path, actor_comm, blocked, received_at FROM file_events ORDER BY id DESC LIMIT 5;"
```

## 12. API 목록

인증 없이 호출:

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/auth/status` | PIN 설정 상태 |
| `POST` | `/auth/setup` | 최초 PIN 설정 |
| `POST` | `/auth/login` | PIN 로그인 및 Bearer token 발급 |

Bearer token 필요:

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/api/agents` | Agent 목록 |
| `GET` | `/api/agents/:id` | Agent 단건 |
| `DELETE` | `/api/agents/:id` | Agent 삭제 |
| `PUT` | `/api/agents/:id/status` | Agent 상태 수동 변경 |
| `GET` | `/api/events?limit=5` | 이벤트 조회 |
| `GET` | `/api/events/stream` | 이벤트 SSE |
| `GET` | `/api/alerts?limit=5` | 알림 조회 |
| `PATCH` | `/api/alerts/:id/resolve` | 알림 해결 처리 |
