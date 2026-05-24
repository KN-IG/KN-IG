#!/usr/bin/env bash
# deploy/setup-agent.sh — Agent VM 역할 셋업 (멱등, 멀티 디스트로, ×N대 공용).
#
# 커널에 따라 백엔드를 자동 선택한다(논문 kernel family 전략):
#   5.8+        → eBPF LSM  (Agent/scripts/setup_ebpf_deps.sh, GRUB lsm=bpf → 재부팅 1회)
#   3.10 ~ 5.7  → LKM       (Agent/scripts/setup_lkm_env.sh, ig_lkm.ko 빌드+상시로드)
#   그 외       → inotify   (AUDIT 폴백)
#
# 인증서는 XOR enrollment(agent --enroll)로 발급받는다 — 정적 인증서 사전배치 불필요.
# 이 스크립트는 빌드/서비스 등록까지 준비하고, 마지막에 enrollment 절차를 안내한다.
# (Enrollment ID/XOR Key는 중앙서버 'kn-ig --server' 설치 시 출력되며, agent --enroll에서 직접 입력)
#
# 사용:
#   sudo ./deploy/setup-agent.sh [--backend HOST] [--port N] [--mode lock|maintenance]
#                                [--certs-dir DIR] [--force-backend ebpf|lkm|inotify]
#                                [--no-service]
#
# cluster.env 의 IG_CENTRAL_HOST / IG_TCP_PORT 를 참고한다.

set -euo pipefail
IG_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${IG_DEPLOY_DIR}/lib/common.sh"
ig_enable_errtrap

BACKEND_OVERRIDE=""; PORT_OVERRIDE=""; MODE="maintenance"
CERTS_DIR_OVERRIDE=""; FORCE_BACKEND=""; WITH_SERVICE=1
while [[ $# -gt 0 ]]; do
    case "$1" in
        --backend)       BACKEND_OVERRIDE="${2:-}"; shift 2 ;;
        --port)          PORT_OVERRIDE="${2:-}"; shift 2 ;;
        --mode)          MODE="${2:-maintenance}"; shift 2 ;;
        --certs-dir)     CERTS_DIR_OVERRIDE="${2:-}"; shift 2 ;;
        --force-backend) FORCE_BACKEND="${2:-}"; shift 2 ;;
        --no-service)    WITH_SERVICE=0; shift ;;
        -h|--help)       sed -n '2,21p' "$0"; exit 0 ;;
        *)               die "알 수 없는 옵션: $1" "사용법은 --help 참고" ;;
    esac
done
[[ "$MODE" == "lock" || "$MODE" == "maintenance" ]] || die "--mode 는 lock|maintenance" \
    "lock=즉시차단(DENY), maintenance=감사만(AUDIT, 안전한 기본값)"

ig_load_cluster
ig_preflight_common

AGENT_DIR="${IG_REPO_ROOT}/Agent"
SCRIPTS="${AGENT_DIR}/scripts"
BACKEND_HOST="${BACKEND_OVERRIDE:-${IG_CENTRAL_HOST:-}}"
[[ -n "$BACKEND_HOST" ]] || die "중앙서버 호스트 미지정" "cluster.env의 IG_CENTRAL_HOST를 채우거나 --backend HOST 지정"
BACKEND_PORT="${PORT_OVERRIDE:-${IG_TCP_PORT:-9000}}"
ENROLL_PORT=9443
# XOR enrollment 도입으로 정적 인증서 사전배치(--certs-dir)는 더 이상 쓰지 않는다(호환을 위해 옵션만 수용).
[[ -n "$CERTS_DIR_OVERRIDE" ]] && warn "--certs-dir 는 enrollment 방식에서 무시됩니다(인증서는 agent --enroll이 발급)."

[[ -d "$AGENT_DIR" ]] || die "Agent 디렉토리 없음: $AGENT_DIR" "저장소 루트에서 실행하세요."
[[ -f "${AGENT_DIR}/CMakeLists.txt" ]] || die "Agent/CMakeLists.txt 없음"

BACKEND="${FORCE_BACKEND:-$(ig_agent_backend)}"
log "백엔드 선택: ${BACKEND} (커널 $(uname -r)) → 중앙서버 ${BACKEND_HOST}:${BACKEND_PORT}, mode=${MODE}"

step "1/6 enrollment 준비 (기존 서비스 중지 + 정적 인증서 정리)"
# XOR enrollment 방식: 인증서는 'agent --enroll'이 SPIFFE identity와 함께 발급한다.
# 정적(static) 인증서가 남아 있으면 ig_enroll_needed()가 false가 되어 enroll이 거부되고,
# 그 인증서엔 SPIFFE identity가 없어 백엔드 REGISTER도 거부된다 → 반드시 제거.
# 반대로 enrollment로 발급된 인증서(SPIFFE URI 보유)는 정상이므로 보존한다(update 멱등).
AGENT_CRT=/etc/ig_monitor/certs/agent.crt

# SPIFFE URI SAN 보유 여부 — setup-central.sh의 cert_san_covers와 동일한 -ext/-text 폴백 패턴.
cert_has_spiffe() {
    local crt="$1"
    [[ -f "$crt" ]] || return 1
    openssl x509 -in "$crt" -noout -ext subjectAltName 2>/dev/null | grep -q 'URI:spiffe://' && return 0
    openssl x509 -in "$crt" -noout -text 2>/dev/null | grep -q 'URI:spiffe://'
}

# 서비스 중지: lock 모드 보호 해제 목적 — enrolled agent여도 5/6에서 다시 기동되므로 안전.
if have systemctl && [[ -f /etc/systemd/system/integrityguard.service ]]; then
    $SUDO systemctl stop integrityguard.service 2>/dev/null || true
    ok "integrityguard.service 중지(lock 보호 해제)"
elif [[ -f /etc/init.d/integrityguard ]]; then
    $SUDO /etc/init.d/integrityguard stop 2>/dev/null || true
    ok "integrityguard(init.d) 중지"
fi

$SUDO mkdir -p /etc/ig_monitor/certs
if cert_has_spiffe "$AGENT_CRT"; then
    ok "기존 enrollment 인증서 보존(SPIFFE identity 확인) — 재발급 불필요"
elif [[ -f "$AGENT_CRT" ]] || [[ -f /etc/ig_monitor/certs/agent.key ]]; then
    $SUDO rm -f /etc/ig_monitor/certs/ca.crt "$AGENT_CRT" /etc/ig_monitor/certs/agent.key 2>/dev/null || true
    ok "정적 인증서(SPIFFE 미보유) 정리 — enrollment로 새 인증서 발급 예정"
else
    log "기존 인증서 없음 — 깨끗한 상태에서 enrollment 진행"
fi

CMAKE="cmake"
ensure_cmake() {
    cmake_ok() { local c="$1"; have "$c" || return 1
        local v; v="$("$c" --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1)"
        [[ -n "$v" ]] && kver_ge "$v" "3.16"; }
    if cmake_ok cmake; then CMAKE="cmake"; return 0; fi
    if cmake_ok cmake3; then CMAKE="cmake3"; return 0; fi
    log "cmake>=3.16 없음 — 설치 시도"
    ig_pkg_refresh
    case "$IG_OS_FAMILY" in
        debian) ig_pkg_install cmake || true ;;
        rhel)   ig_pkg_install cmake3 || ig_pkg_install cmake || true ;;
    esac
    cmake_ok cmake && { CMAKE="cmake"; return 0; }
    cmake_ok cmake3 && { CMAKE="cmake3"; return 0; }
    # Kitware 공식 설치 스크립트 폴백(임의 Linux x86_64/aarch64)
    local kv=3.28.3 karch
    case "$(uname -m)" in
        x86_64|amd64) karch="x86_64" ;;
        aarch64|arm64) karch="aarch64" ;;
        *) die "cmake 자동설치 불가 arch: $(uname -m)" "cmake>=3.16 수동 설치 후 재실행" ;;
    esac
    log "Kitware cmake ${kv} (${karch}) /usr/local 설치"
    local tmp; tmp="$(mktemp)"
    retry 3 5 -- curl -fsSL "https://github.com/Kitware/CMake/releases/download/v${kv}/cmake-${kv}-linux-${karch}.sh" -o "$tmp"
    $SUDO sh "$tmp" --prefix=/usr/local --skip-license >/dev/null
    rm -f "$tmp"
    cmake_ok cmake && { CMAKE="cmake"; return 0; }
    die "cmake>=3.16 확보 실패" "수동으로 cmake 3.16+ 설치 후 재실행"
}

step "2/6 의존성 (${BACKEND})"
install_build_essentials() {
    ig_pkg_refresh
    case "$IG_OS_FAMILY" in
        debian) ig_pkg_install build-essential pkg-config libssl-dev libsystemd-dev || true ;;
        rhel)   ig_pkg_install gcc gcc-c++ make pkgconfig openssl-devel systemd-devel || true ;;
    esac
    # systemd 유닛이 Type=notify 라 libsystemd 헤더가 필수(daemon.c가 무조건 include).
    # 위 설치가 transient로 실패하면 빌드가 'sd-daemon.h 없음'으로 모호하게 죽으므로 별도 확인.
    if ! pkg-config --exists libsystemd 2>/dev/null; then
        case "$IG_OS_FAMILY" in
            debian) ig_pkg_install libsystemd-dev || true ;;
            rhel)   ig_pkg_install systemd-devel || true ;;
        esac
        if ! pkg-config --exists libsystemd 2>/dev/null; then
            warn "libsystemd 개발 헤더 미확보 — 빌드가 sd-daemon.h 오류로 실패하거나 Type=notify 기동이 실패할 수 있음."
            hint "수동 설치: apt install libsystemd-dev  /  yum install systemd-devel"
        fi
    fi
}

case "$BACKEND" in
    ebpf)
        [[ -x "${SCRIPTS}/setup_ebpf_deps.sh" ]] || die "setup_ebpf_deps.sh 없음"
        mark "eBPF 의존성 설치 실패 — 네트워크/저장소(EPEL/crb) 확인"
        $SUDO bash "${SCRIPTS}/setup_ebpf_deps.sh" || die "eBPF 의존성 설치 실패" \
            "$SUDO bash ${SCRIPTS}/setup_ebpf_deps.sh 를 직접 실행해 원인 확인"
        install_build_essentials
        # LSM 스택에 bpf 없으면 GRUB는 갱신됐고 재부팅이 필요 — 오류가 아니라 '대기'.
        if ! grep -qw bpf /sys/kernel/security/lsm 2>/dev/null; then
            warn "LSM 스택에 bpf 미포함 — eBPF LSM 활성화를 위해 재부팅이 필요합니다."
            hint "재부팅 후 같은 명령을 다시 실행하면 빌드·설치 단계로 이어집니다:"
            hint "  sudo reboot   # 재기동 후"
            hint "  sudo ${IG_DEPLOY_DIR}/setup-agent.sh"
            ok "여기까지 정상(멱등). 재부팅 후 재실행하세요."
            exit 0
        fi
        ok "LSM 스택에 bpf 포함 확인 — 계속 진행"
        ;;
    lkm)
        [[ -x "${SCRIPTS}/setup_lkm_env.sh" ]] || die "setup_lkm_env.sh 없음"
        mark "LKM 의존성/모듈 빌드 실패 — kernel-devel/헤더 또는 CentOS7 vault 저장소 확인"
        $SUDO bash "${SCRIPTS}/setup_lkm_env.sh" || die "LKM 환경 셋업 실패" \
            "$SUDO bash ${SCRIPTS}/setup_lkm_env.sh 를 직접 실행해 원인 확인"
        install_build_essentials
        ;;
    inotify)
        warn "eBPF/LKM 비대상 커널($(uname -r)) — inotify(AUDIT) 폴백으로 빌드"
        install_build_essentials
        ;;
    *) die "알 수 없는 백엔드: $BACKEND" "--force-backend ebpf|lkm|inotify" ;;
esac

ensure_cmake
ok "cmake: $($CMAKE --version | head -1) (${CMAKE})"

step "3/6 agent 빌드"
BIN="${AGENT_DIR}/build/agent"
mark "빌드 실패 — 헤더/라이브러리(libssl/libsystemd) 또는 cmake 버전 확인"
( cd "$AGENT_DIR"
  rm -rf build                       # 트러블슈팅 #4: 호스트에서 만든 CMakeCache 오염 차단
  "$CMAKE" -S . -B build >/dev/null
  "$CMAKE" --build build -j"$(nproc 2>/dev/null || echo 2)" >/dev/null )
[[ -x "$BIN" ]] || die "agent 바이너리 빌드 실패: $BIN" "cd Agent && rm -rf build && cmake -S . -B build && cmake --build build 로 확인"
ok "바이너리: $BIN"

if [[ "$BACKEND" == "lkm" ]]; then
    step "4/6 LKM 모듈 적재"
    KO="${AGENT_DIR}/src/lkm/ig_lkm.ko"
    [[ -f "$KO" ]] || die "ig_lkm.ko 없음: $KO" "setup_lkm_env.sh 빌드 산출물을 확인하세요."
    # 설치 + depmod + 부팅 시 자동 로드 + 즉시 로드 (모두 멱등)
    moddir="/lib/modules/$(uname -r)/extra"
    $SUDO install -D -m 0644 "$KO" "${moddir}/ig_lkm.ko"
    $SUDO depmod -a 2>/dev/null || true
    # 구형 배포판은 /etc/modules-load.d 가 없을 수 있음 — 먼저 생성(부팅 자동 로드용, systemd-modules-load)
    $SUDO mkdir -p /etc/modules-load.d
    echo "ig_lkm" | $SUDO tee /etc/modules-load.d/ig_lkm.conf >/dev/null
    if lsmod 2>/dev/null | grep -q '^ig_lkm'; then
        ok "ig_lkm 이미 로드됨"
    else
        $SUDO modprobe ig_lkm 2>/dev/null || $SUDO insmod "$KO" 2>/dev/null || \
            warn "ig_lkm 로드 실패 — dmesg 확인(서명/커널 불일치). 재부팅 후 자동 로드 시도됨."
        lsmod 2>/dev/null | grep -q '^ig_lkm' && ok "ig_lkm 로드 성공" || true
    fi
    [[ -e /dev/ig_lkm ]] && ok "/dev/ig_lkm 존재 — LKM 활성" || warn "/dev/ig_lkm 미존재 — 로드/재부팅 후 재확인"
else
    step "4/6 LKM 모듈 적재 — (${BACKEND} 모드, 생략)"
fi

step "5/6 /etc/ig_monitor 구성 + 서비스"
CONF_SRC="${AGENT_DIR}/configs/ig.conf"
UNIT_SRC="${AGENT_DIR}/integrityguard.service"
[[ -f "$CONF_SRC" ]] || die "ig.conf 없음: $CONF_SRC"
[[ -f "$UNIT_SRC" ]] || die "integrityguard.service 없음: $UNIT_SRC"

# certs 디렉토리만 준비(enrollment가 ca.crt/agent.crt/agent.key를 여기에 발급).
# 정적 인증서는 복사하지 않는다(XOR enrollment 방식).
$SUDO mkdir -p /etc/ig_monitor/certs
$SUDO chown -R root:root /etc/ig_monitor

# monitor_type: 백엔드 선택(ebpf/lkm/inotify)을 enrollment metadata로 전달.
# agent의 parse_enroll_monitor_type은 ebpf/fanotify/lkm을 인식(inotify는 lkm 기본 폴백).
case "$BACKEND" in
    ebpf)    ENROLL_MON=ebpf ;;
    lkm)     ENROLL_MON=lkm ;;
    *)       ENROLL_MON=fanotify ;;
esac
ig_install_stdin /etc/ig_monitor/ig.env 0640 root:root <<EOF
# KN-IG Agent transport — deploy/setup-agent.sh 생성 ($(date -u +%FT%TZ))
IG_SERVER_HOST=${BACKEND_HOST}
IG_SERVER_PORT=${BACKEND_PORT}
IG_CA_CRT=/etc/ig_monitor/certs/ca.crt
IG_AGENT_CRT=/etc/ig_monitor/certs/agent.crt
IG_AGENT_KEY=/etc/ig_monitor/certs/agent.key
# XOR enrollment (신규 등록 — Enrollment ID/XOR Key는 'agent --enroll'에서 직접 입력)
IG_ENROLL_HOST=${BACKEND_HOST}
IG_ENROLL_PORT=${ENROLL_PORT}
IG_ENROLL_MONITOR_TYPE=${ENROLL_MON}
EOF
$SUDO install -m 0640 "$CONF_SRC" /etc/ig_monitor/ig.conf
$SUDO install -m 0755 "$BIN" /usr/local/bin/agent
ok "/etc/ig_monitor/{ig.env, ig.conf, certs/} + /usr/local/bin/agent"

if [[ "$WITH_SERVICE" -eq 1 ]] && have systemctl; then
    # 기본 유닛(integrityguard.service)은 ExecStart에 -m 모드가 없어 lock(DENY)이 기본.
    # MODE를 반영해 ExecStart를 덮어쓴다(드롭인). maintenance면 -m maintenance 추가.
    $SUDO install -m 0644 "$UNIT_SRC" /etc/systemd/system/integrityguard.service
    if [[ "$MODE" == "maintenance" ]]; then
        $SUDO mkdir -p /etc/systemd/system/integrityguard.service.d
        ig_install_stdin /etc/systemd/system/integrityguard.service.d/10-mode.conf 0644 root:root <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/local/bin/agent -f -c /etc/ig_monitor/ig.conf -m maintenance
EOF
    else
        $SUDO rm -f /etc/systemd/system/integrityguard.service.d/10-mode.conf 2>/dev/null || true
    fi
    $SUDO systemctl daemon-reload
    $SUDO systemctl reset-failed integrityguard.service 2>/dev/null || true
    # enrollment 전(인증서 없음)에 start하면 REGISTER 실패만 반복한다 → enable만 하고 start는 보류.
    # enrollment 후(agent.crt 존재) 재실행이면 정상 기동.
    $SUDO systemctl enable integrityguard.service 2>/dev/null || true
    if [[ -f /etc/ig_monitor/certs/agent.crt ]]; then
        mark "agent 기동 실패 — journalctl -u integrityguard.service (TLS/인증서/eBPF·LKM 활성 확인)"
        $SUDO systemctl restart integrityguard.service
        sleep 2
        ok "서비스 상태: $($SUDO systemctl is-active integrityguard.service 2>/dev/null || echo unknown) (mode=${MODE})"
    else
        ok "서비스 enable 완료 — enrollment 전이라 start는 보류(인증서 발급 후 자동/수동 start)"
    fi
elif [[ "$WITH_SERVICE" -eq 1 ]]; then
    # systemd 미사용(upstart/sysvinit, 예: Ubuntu 14.04) — SysV init.d로 설치/기동.
    # 에이전트는 -f 없으면 자체 데몬화하며 /tmp/ig_monitor.pid 를 기록한다.
    step "5/6 systemd 미사용 — init.d 서비스 설치"
    ig_install_stdin /etc/init.d/integrityguard 0755 root:root <<EOF
#!/bin/sh
### BEGIN INIT INFO
# Provides:          integrityguard
# Required-Start:    \$network \$remote_fs
# Required-Stop:     \$network \$remote_fs
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: KN-IG Integrity Guard Agent
### END INIT INFO
DAEMON=/usr/local/bin/agent
CONF=/etc/ig_monitor/ig.conf
PIDFILE=/tmp/ig_monitor.pid
MODE=${MODE}
running() { [ -f "\$PIDFILE" ] && kill -0 "\$(cat "\$PIDFILE" 2>/dev/null)" 2>/dev/null; }
case "\$1" in
  start)   running && { echo "already running"; exit 0; }; "\$DAEMON" -c "\$CONF" -m "\$MODE" && echo "started (mode=\$MODE)" ;;
  stop)    running && kill "\$(cat "\$PIDFILE")" 2>/dev/null; rm -f "\$PIDFILE"; echo "stopped" ;;
  restart) "\$0" stop; sleep 1; "\$0" start ;;
  status)  if running; then echo "running (pid \$(cat "\$PIDFILE"))"; else echo "not running"; exit 3; fi ;;
  *)       echo "Usage: \$0 {start|stop|restart|status}"; exit 1 ;;
esac
EOF
    if   have update-rc.d; then $SUDO update-rc.d integrityguard defaults >/dev/null 2>&1 || true
    elif have chkconfig;  then $SUDO chkconfig --add integrityguard 2>/dev/null || true; fi
    # enrollment 전(인증서 없음)에는 기동 보류 — REGISTER 실패 반복 방지.
    if [[ -f /etc/ig_monitor/certs/agent.crt ]]; then
        $SUDO /etc/init.d/integrityguard restart 2>/dev/null || $SUDO /etc/init.d/integrityguard start || true
        sleep 2
        if /etc/init.d/integrityguard status >/dev/null 2>&1; then
            ok "integrityguard 실행 중 (init.d, mode=${MODE})"
        else
            warn "integrityguard 미기동 — 로그 확인: tail /var/log/ig_monitor.log"
        fi
    else
        ok "init.d 등록 완료 — enrollment 전이라 start 보류(인증서 발급 후 start)"
    fi
else
    step "5/6 서비스 설치 생략(--no-service) — 수동 실행 안내"
    log "  sudo /usr/local/bin/agent -f -c /etc/ig_monitor/ig.conf -m ${MODE}"
fi

step "6/6 검증"
if tcp_open "$BACKEND_HOST" "$BACKEND_PORT" 5; then
    ok "중앙서버 ${BACKEND_HOST}:${BACKEND_PORT} 도달 가능(TCP)"
else
    warn "중앙서버 ${BACKEND_HOST}:${BACKEND_PORT} 미도달 — 중앙 기동/방화벽 확인."
    hint "Agent는 백그라운드 재연결(backoff)을 내장하므로, 중앙서버가 올라오면 자동 등록됩니다."
fi
# enrollment 서버(:9443) 도달 확인 — 인증서 발급 단계에서 필요.
if tcp_open "$BACKEND_HOST" "$ENROLL_PORT" 5; then
    ok "enrollment 서버 ${BACKEND_HOST}:${ENROLL_PORT} 도달 가능(TCP)"
else
    warn "enrollment ${BACKEND_HOST}:${ENROLL_PORT} 미도달 — 중앙서버 ENROLL_ADDR/방화벽 확인(인증서 발급에 필요)."
fi
# enrollment 완료(인증서 존재) 시에만 서비스 active를 기대한다.
if [[ -f /etc/ig_monitor/certs/agent.crt ]] && [[ "$WITH_SERVICE" -eq 1 ]] && have systemctl; then
    if $SUDO systemctl is-active --quiet integrityguard.service; then
        ok "integrityguard.service active"
    else
        die "integrityguard.service 비활성" "journalctl -u integrityguard.service -n 50 --no-pager"
    fi
fi

echo
NEED_ENROLL=0
[[ ! -f /etc/ig_monitor/certs/agent.crt ]] && NEED_ENROLL=1
ok "Agent 셋업 완료 (${BACKEND}, mode=${MODE})"
log "  중앙서버 : ${BACKEND_HOST}:${BACKEND_PORT}   enrollment: ${BACKEND_HOST}:${ENROLL_PORT}"
log "  agent_id : enrollment 시 중앙서버가 SPIFFE identity와 함께 자동 부여"
log "  로그     : sudo journalctl -u integrityguard.service -f"
log "  등록 확인: 중앙서버에서  curl -s http://127.0.0.1:${IG_HTTP_PORT:-8080}/api/agents | jq ."
log "  전체 점검: deploy/verify.sh"
[[ "$MODE" == "maintenance" ]] && \
    log "  ※ maintenance(감사) 모드 — 모든 백엔드(eBPF/LKM) 공통 적용. 차단 없이 이벤트만 전송. 차단: --mode lock 로 재실행"
if [[ "$NEED_ENROLL" -eq 1 ]]; then
    echo
    printf '%s━━ 다음 단계: enrollment를 완료하세요 ━━━━━━━━━━━━━━━%s\n' "$_C_YLW" "$_C_RST"
    log "  1) 중앙서버 설치(kn-ig --server) 출력의 Enrollment ID / XOR Key를 준비"
    log "  2) sudo IG_ENROLL_HOST=${BACKEND_HOST} IG_ENROLL_PORT=${ENROLL_PORT} agent --enroll"
    log "       → 프롬프트에 Enrollment ID와 XOR Key를 입력(인증서 자동 발급)"
    if have systemctl; then
        log "  3) sudo systemctl start integrityguard      # 발급 후 기동"
    else
        log "  3) sudo /etc/init.d/integrityguard start     # 발급 후 기동"
    fi
    printf '%s━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%s\n' "$_C_YLW" "$_C_RST"
fi
