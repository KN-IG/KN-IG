# KN-IG 트러블슈팅 로그 (해결됨)

배포·빌드·콘솔에서 겪고 **해결한** 문제만 간결히 정리합니다(증상 → 원인 → 해결 커밋).
미해결 항목은 [`TODO.md`](TODO.md), 배포 절차는 [`deploy/README.md`](deploy/README.md) 참고.

## 배포 (deploy/kn-ig)

| 증상 | 원인 → 해결 | 커밋 |
|---|---|---|
| MySQL 설치 후 "DB 서비스 유닛을 찾지 못함"으로 중단 | `systemctl list-unit-files` 텍스트 파싱이 환경별로 매칭 실패 → **유닛 파일 직접 확인**(+설치 직후 `daemon-reload` 재시도) | `8d74c93`, `22dd27c` |
| `--server` 8/8 검증이 정상 서버를 "비정상"으로 오판 | 인증 걸린 `/api/agents`가 토큰 없이 401인데 2xx만 정상으로 봄 → 무인증 **`/auth/status`(200)** 로 점검 | `7530bc4` |
| `--llm` venv 생성 실패 (`ensurepip` 없음) | Ubuntu는 `python3.X-venv` 별도 패키지 필요 → ensurepip 기준 판단 후 자동 설치 + **깨진 venv 자동 재생성** | `3ecb007`, `83e5318` |
| 구형 bash에서 `--agent` 시 `EXTRA[@]: unbound variable` | `set -u` + bash<4.4에서 빈 배열 확장 오류 → `"${EXTRA[@]+...}"` 안전 확장 | `b5b0410` |
| 구형/EOL VM에서 `git clone` → `server certificate verification failed` | 시계 오차 또는 CA 번들 노후 → 시계 보정 / `ca-certificates` 갱신 / `sslVerify=false` / 중앙에서 `scp` (deploy 트러블슈팅 섹션) | `c024294` |

## 에이전트 LKM 빌드 (구형 커널 3.13/4.15)

| 증상 | 원인 → 해결 | 커밋 |
|---|---|---|
| `implicit declaration of 'schedule'` / `current->comm` incomplete type | `<linux/sched.h>` 미포함(구형 커널 전이포함 안 됨) → 명시 추가 | `2ef4f96`(chardev), `5f8e2a4`(lkm310) |
| `hlist_add_tail_rcu` incompatible pointer type (4.15) | LSM 훅 리스트가 **커널 4.16에서 list_head→hlist 전환** → `<4.16`은 `list_*_rcu`로 분기 | `acc2562` |
| `CMake 3.x or higher is required` (14.04=2.8, 18.04=3.10) | 불필요하게 높은 최소요구 → **2.8.12**로 하향 + `<3.1`은 `-std=gnu11` 플래그로 C11 보강 | `68ced3f`, `1cf7b5e` |
| proc_cache: `tracepoint_probe_register` 타입 불일치, `READ_ONCE`/`FOLL_ANON`/`ktime_get_real_ns` 미정의 | API 도입 버전 차이(3.15/3.19/4.6/3.17) → 버전 분기 + 호환 shim | `ba2dc14`, `d9934ef` |

> LKM `/etc` 전체 감시 런타임 크래시는 **미해결** — [`TODO.md`](TODO.md) 참고.

## 콘솔 (Frontend/desktop)

| 증상 | 원인 → 해결 | 커밋 |
|---|---|---|
| maintenance(감사) 모드인데 콘솔에 모두 BLOCKED 표시 | 프론트가 action 하드코딩 + 백엔드가 `blocked` 미디코드 → blocked를 에이전트→백엔드→콘솔 전파(BLOCKED/DETECTED) | `cec41f8`, `5bb2687` |
| 드래그(선택) 시 글자가 흰색으로 사라짐 | `reportV2.css`의 전역 `::selection`이 스코프 밖 `--blue`(undefined) 참조 → `.report-v2`로 스코프 + 토큰 기반 전역 선택색 추가 | `c5ea948` |
| Dashboard/Report 실연동 계약 불일치(alert 시각·resolve 동사) | `OccurredAt→CreatedAt`, `POST→PATCH` 정합 | `ccf6f6a` |

---
> 실연동 시 DB 마이그레이션: blocked 컬럼 추가 — `ALTER TABLE file_events ADD COLUMN blocked BOOLEAN NOT NULL DEFAULT FALSE AFTER pid;` (신규 설치는 schema.sql 포함).
