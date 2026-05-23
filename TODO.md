# KN-IG TODO (미해결)

해결된 문제는 [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) 참고.

## 높음

### LKM `/etc` 전체 감시 시 커널 크래시 — 원인 규명 + 수정 적용, VM 검증 대기
- **증상**: lock·maintenance 무관, `/etc` 전체(recursive) 감시 + 파일 op(`sudo touch /etc/ssh/...`) → `Segmentation fault`. 이후 `sudo` 등 정상 명령도 죽어 시스템 불안정.
- **범위**: 특정 경로 감시(예: `/root/igtest`, `/etc/ssh`)는 maintenance·lock 모두 정상(PID chain 포함). **eBPF는 영향 없음**.
- **근본 원인(규명)**: **커널 스택 오버플로**. `struct ig_lkm_event`가 `chain[16]`(엔트리당 448 B) 임베드로 **~7.3 KB**인데, `ig_event_enqueue()`가 이를 **커널 스택에** 잡았음. 이 함수는 LSM 훅에서 syscall→VFS→LSM로 깊어진 스택 위에 **동기 호출**되고, 커널 스택은 8 KB(3.x)~16 KB(4.x)뿐 → 단일 7.3 KB 프레임이 스택을 넘겨 인접 메모리(thread_info/이웃 스택) 손상 → 사후 시스템 전체 불안정. `/etc` 전체는 sudo/PAM/NSS/ld.so 등 깊은 스택의 다양한 프로세스가 매번 훅에 진입해 발현, 특정 경로(얕은 스택 test 프로세스)는 여유가 있어 미발현. eBPF는 bounded VM 스택이라 무관 — **모든 증상과 일치**.
- **수정(적용)**: 이벤트 구조체를 스택 → 힙으로 분리. `ig_event_enqueue`는 `kmalloc(GFP_ATOMIC)`(atomic 안전, 실패 시 드롭·차단 결정은 이미 끝남), `ig_read`는 `kmalloc(GFP_KERNEL)`. ABI(구조체 레이아웃)·기능 불변.
- **검증 대기**: darwin에서 커널 모듈 빌드 불가. **lkm415 VM에서** `kn-ig --update` → `/etc` 전체 감시 설정 → `sudo touch /etc/ssh/ssh_config` 반복이 더 이상 크래시 없이 이벤트만 올라오는지 확인 필요. 통과 시 `TROUBLESHOOTING.md`로 승격(커밋 해시 기재).
- **워크어라운드(검증 전까지)**: LKM 기기는 **특정 경로만 감시**, `/etc` 전체 보호가 필요하면 **eBPF(5.8+)** 사용.

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
