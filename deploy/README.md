# KN-IG 배포 (`deploy/`)

각 VM 터미널에서 **역할 한 줄**. 단일 진입점은 루트 `kn-ig`.

| 역할 | 명령 | 듣는 포트 | 나가는 연결 |
|---|---|---|---|
| 중앙 서버 | `sudo ./kn-ig --server` | `:8080`(콘솔) · `:9000`(mTLS) | LLM `:8088` |
| LLM 서버 | `sudo ./kn-ig --llm` | `:8088` | — |
| Agent | `sudo ./kn-ig --agent <중앙IP>` | — | 중앙 `:9000` |

- 검증: `kn-ig --verify` → **FAIL=0** 이면 콘솔↔중앙↔DB · 중앙↔LLM · Agent↔중앙 동작.
- 운영(역할 자동 감지): `kn-ig`(상태) · `--status` · `--logs [-f]` · `--uninstall [--purge]`
- 검증 순서·실패 대응: **[../docs/verification.md](../docs/verification.md)**

> `agent_id = hash(hostname+IP)` 라 Agent는 IP만 달라도 자동으로 다른 ID. 인증서는 공용.

## 옵션

```bash
--server --ip <IP>          # Agent/콘솔이 접속할 주소(cert SAN). 미지정 시 자기 IP 자동
--server --llm-host <HOST>  # LLM 서버 위치. 미지정 시 127.0.0.1
--agent <IP> --certs <DIR>  # 물리 제공 인증서 경로 (기본 Agent/certs)
--agent <IP> --mode lock    # 즉시 차단 (기본 maintenance=감사)
```

## LLM API 키 (선택 — `kn-ig --llm` 전에)

키가 없어도 템플릿 서술로 리포트는 정상이며, 키를 넣으면 서술 품질만 올라갑니다.
`kn-ig --llm`은 **기존 `LLM/.env`를 보존(덮어쓰지 않음)**, 없으면 `cluster.env` 키로 생성합니다.

```bash
# 방법 A — LLM/.env 미리 작성 (간단)
cp LLM/.env.example LLM/.env
# LLM/.env 편집: GEMINI_API_KEY=... (또는 OPENAI_API_KEY=...)

# 방법 B — cluster.env에 넣기 (.env 없을 때만 반영)
echo 'IG_GEMINI_API_KEY=...' >> cluster.env

sudo ./kn-ig --llm
curl -s localhost:8088/health   # "llm_provider_configured":true 면 키 인식
```
이미 `.env`가 생성됐다면 `LLM/.env` 직접 편집 후 `sudo systemctl restart kn-ig-llm`.
키는 `LLM/.env`·`cluster.env`에만 — git 커밋 금지.

## 인증서 (물리 부트스트랩)

Agent 인증서는 네트워크 배포 없이 **물리적으로 삽입**합니다(망분리 OT 보안).
중앙 `--server` → `Backend/certs/{ca,agent}.{crt,key}` 생성 → USB 등으로 각 Agent의 `Agent/certs/`에 배치 → `--agent <중앙IP>`.
중앙 IP 변경 시 `--server --ip <새IP>` (CA 보존, server 인증서만 재서명 → 기존 agent 유효).

## 멀티 디스트로 / 커널

Ubuntu(apt)/CentOS·RHEL(yum·dnf) 자동 분기. 커널 **5.8+ eBPF · 3.10~5.7 LKM · 그 외 inotify**.
구버전 cmake(<3.16)는 Kitware로 자동 보강. 모든 단계 **멱등**(재실행 항상 안전, transient 재시도, 실패 시 처방 출력).

## 구성

```
kn-ig                                진입점(역할 디스패치 + 자동 PATH 설치)
deploy/lib/common.sh                 공통 라이브러리
deploy/setup-{central,llm,agent}.sh  역할별 설치
deploy/verify.sh                     검증
```
고급: `cluster.env`(IP/포트/DB 일괄 지정)를 두면 자동 로드(선택).

## 보안

- 중앙 `Backend/.env`(DB 비번)·`LLM/.env`(API 키)에 비밀 — git 커밋 금지(`.gitignore` 확인).
- Agent 인증서는 물리 이동만(네트워크 전송 안 함).

## 검증 한계

로컬 검증: `bash -n` · Go linux/amd64 크로스빌드+`vet` · LLM `pytest`+uvicorn 실구동 · openssl mTLS 체인 ·
**실 Backend 코드로 mTLS 핸드셰이크→REGISTER→FILE_EVENT 통합 테스트**. 실 4 VM의 네트워킹·MySQL 영속·커널 후킹은 `kn-ig --verify`가 책임.
