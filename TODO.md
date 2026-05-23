# KN-IG TODO (미해결)

해결된 문제는 [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) 참고.

## 높음

### LKM `/etc` 전체 감시 시 커널 크래시 (4.15 lkm415 / 3.x)
- **증상**: lock·maintenance 무관, `/etc` 전체(recursive) 감시 + 파일 op(`sudo touch /etc/ssh/...`) → `Segmentation fault`. 이후 `sudo` 등 정상 명령도 죽어 시스템 불안정.
- **범위**: 특정 경로 감시(예: `/root/igtest`, `/etc/ssh`)는 maintenance·lock 모두 정상(PID chain 포함). **eBPF는 영향 없음**(/etc 전체도 안전).
- **막힌 이유**: 런타임 커널 메모리 손상 → 코드 정독으론 미특정(정책 저장소는 동적 해시테이블, 훅은 NULL 가드, 읽기는 early-return). **oops `RIP`(죽는 함수) 트레이스가 있어야** 해당 함수 기준으로 C 수정 가능.
- **다음 단계**: 크래시 후 재부팅(GRUB `modprobe.blacklist=ig_lkm`) → `journalctl -k -b -1`의 oops 확보 → `lkm415.c`/관련 C 수정 → `kn-ig --update` 전파.
- **워크어라운드(현재)**: LKM 기기는 **특정 경로만 감시**, `/etc` 전체 보호가 필요하면 **eBPF(5.8+)** 사용.

## 중간

### LKM310(커널 3.13) 런타임 검증 미완
- 빌드 픽스(sched.h / tracepoint / cmake / READ_ONCE 등) 적용 완료. `ig_lkm.ko`·agent 빌드 통과 후 **실제 적재·이벤트·차단 동작 검증 대기**.

### Report 실데이터는 LLM 서버 가동 전제
- LLM(:8088) 미도달/오류 시 mock 폴백(HERO에 사유 칩 표시). 운영 시 `kn-ig --status`로 LLM 도달 + `Backend/.env`의 `LLM_SERVER_URL` 확인.

## 낮음 / 다음 사이클

### Logs·Policy 백엔드 미구현
- 현재 mock 고정(provider seam 준비됨). `/api/logs`·`/api/policy` 신설 시 `logsProvider`/`policyProvider` 한 줄 교체.

### LKM `/etc` 안전장치 미적용
- 위 크래시 수정 전까지 위험 구성(LKM + `/etc` 전체 감시) 배포 차단 가드 또는 inotify 폴백을 둘 수 있으나 **보류**(원인 수정 우선).
