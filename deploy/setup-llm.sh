#!/usr/bin/env bash
# deploy/setup-llm.sh — LLM 서버 VM 역할 셋업 (멱등).
#
#   1) Python(>=3.9) 확인 (멀티 디스트로)
#   2) venv + 의존성 설치 (재시도)
#   3) .env 준비 (기존 키 보존 — 절대 덮어쓰지 않음)
#   4) systemd 서비스 등록 + 0.0.0.0 바인드 (중앙서버가 도달 가능하게)
#   5) /health 검증
#
# 사용:
#   ./deploy/setup-llm.sh [--no-service] [--port N] [--bind ADDR]
#
# cluster.env 의 IG_LLM_PORT / IG_GEMINI_API_KEY / IG_OPENAI_API_KEY 를 참고한다.

set -euo pipefail
IG_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${IG_DEPLOY_DIR}/lib/common.sh"
ig_enable_errtrap

WITH_SERVICE=1
PORT_OVERRIDE=""
BIND_ADDR="0.0.0.0"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-service) WITH_SERVICE=0; shift ;;
        --port)       PORT_OVERRIDE="${2:-}"; shift 2 ;;
        --bind)       BIND_ADDR="${2:-0.0.0.0}"; shift 2 ;;
        -h|--help)    sed -n '2,14p' "$0"; exit 0 ;;
        *)            die "알 수 없는 옵션: $1" "사용법은 --help 참고" ;;
    esac
done

ig_load_cluster
ig_preflight_common

LLM_DIR="${IG_REPO_ROOT}/LLM"
VENV_DIR="${LLM_DIR}/.venv"
PORT="${PORT_OVERRIDE:-${IG_LLM_PORT:-8088}}"
[[ -d "$LLM_DIR" ]] || die "LLM 디렉토리 없음: $LLM_DIR" "저장소 루트에서 실행하세요."
[[ -f "${LLM_DIR}/requirements.txt" ]] || die "requirements.txt 없음: ${LLM_DIR}"

PY=""
find_python() {
    local c
    for c in python3.13 python3.12 python3.11 python3.10 python3.9 python3; do
        have "$c" || continue
        if "$c" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] >= (3,9) else 1)' 2>/dev/null; then
            PY="$c"; return 0
        fi
    done
    return 1
}
step "1/5 Python(>=3.9) 확인"
if ! find_python; then
    log "적합한 python3(>=3.9) 미발견 — 설치 시도"
    ig_pkg_refresh
    case "$IG_OS_FAMILY" in
        debian) ig_pkg_install python3 python3-venv python3-pip ;;
        rhel)   ig_pkg_install python3 python3-pip || true ;;
        *)      : ;;
    esac
    find_python || die "Python>=3.9 확보 실패 (현재 OS: ${IG_OS_PRETTY})" \
        "구형(CentOS7=3.6)은 EPEL/SCL/pyenv로 3.9+ 설치 후 재실행. 예: dnf install python39 / apt install python3 python3-venv"
fi
ok "Python: $("$PY" --version 2>&1) (${PY})"

# venv 모듈 가용성(데비안 계열은 python3-venv 별도 패키지)
if ! "$PY" -c 'import venv' 2>/dev/null; then
    log "venv 모듈 없음 — 설치 시도"
    ig_pkg_refresh
    [[ "$IG_OS_FAMILY" == "debian" ]] && ig_pkg_install python3-venv || true
    "$PY" -c 'import venv' 2>/dev/null || die "python venv 모듈 확보 실패" \
        "Ubuntu: sudo apt install python3-venv / RHEL: python3 표준 포함"
fi

step "2/5 venv + 의존성"
if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
    log "venv 생성: ${VENV_DIR}"
    "$PY" -m venv "$VENV_DIR"
else
    log "venv 존재 — 재사용"
fi
PIP="${VENV_DIR}/bin/pip"
mark "pip 업그레이드 실패 — 인터넷/프록시(pip.conf) 확인"
retry 3 5 -- "$PIP" install --upgrade pip >/dev/null
mark "의존성 설치 실패 — 네트워크 또는 빌드 도구(gcc/python3-dev) 부족 가능"
retry 3 5 -- "$PIP" install -r "${LLM_DIR}/requirements.txt"
ok "의존성 설치 완료"

step "3/5 .env 준비"
ENV_FILE="${LLM_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
    ok ".env 존재 — 보존(덮어쓰지 않음). 키 변경은 직접 편집하세요."
else
    log ".env 생성 (cluster.env 키 반영, 없으면 템플릿 폴백)"
    ig_write_atomic "$ENV_FILE" <<EOF
PROVIDER_ORDER=gemini,openai
GEMINI_API_KEY=${IG_GEMINI_API_KEY:-}
GEMINI_MODEL=gemini-2.5-flash
OPENAI_API_KEY=${IG_OPENAI_API_KEY:-}
OPENAI_MODEL=gpt-4o-mini
LLM_PORT=${PORT}
EOF
    chmod 600 "$ENV_FILE" 2>/dev/null || true
    if [[ -n "${IG_GEMINI_API_KEY:-}${IG_OPENAI_API_KEY:-}" ]]; then
        ok ".env 생성 — 제공자 키 반영됨"
    else
        warn ".env 생성 — 키 없음. 템플릿 서술로 폴백 동작합니다(정상)."
    fi
fi

UVICORN="${VENV_DIR}/bin/uvicorn"
SVC_NAME="kn-ig-llm.service"
if [[ "$WITH_SERVICE" -eq 1 ]] && have systemctl; then
    step "4/5 systemd 서비스 등록 (${SVC_NAME})"
    local_user="${SUDO_USER:-$(id -un)}"
    local_group="$(id -gn "$local_user" 2>/dev/null || echo "$local_user")"
    ig_install_stdin "/etc/systemd/system/${SVC_NAME}" 0644 root:root <<EOF
[Unit]
Description=KN-IG LLM Report Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${local_user}
Group=${local_group}
WorkingDirectory=${LLM_DIR}
ExecStart=${UVICORN} app.main:app --host ${BIND_ADDR} --port ${PORT}
Restart=on-failure
RestartSec=3s

[Install]
WantedBy=multi-user.target
EOF
    $SUDO systemctl daemon-reload
    $SUDO systemctl reset-failed "$SVC_NAME" 2>/dev/null || true
    mark "uvicorn 기동 실패 — journalctl -u ${SVC_NAME} 확인 (의존성/포트 충돌)"
    $SUDO systemctl enable --now "$SVC_NAME"
    $SUDO systemctl restart "$SVC_NAME"   # 재실행 시 새 코드/설정 반영(멱등)
    ig_open_firewall_port "$PORT" tcp
    ok "서비스 active: $($SUDO systemctl is-active "$SVC_NAME" 2>/dev/null || echo unknown)"
else
    step "4/5 systemd 미사용 — 수동 실행 명령 안내"
    log "다음 명령으로 직접 실행하세요(포그라운드):"
    printf '    %s app.main:app --host %s --port %s    # (cwd=%s)\n' "$UVICORN" "$BIND_ADDR" "$PORT" "$LLM_DIR"
fi

step "5/5 /health 검증"
if [[ "$WITH_SERVICE" -eq 1 ]] && have systemctl; then
    if wait_tcp 127.0.0.1 "$PORT" 30 1; then
        if http_ok "http://127.0.0.1:${PORT}/health"; then
            ok "LLM 서버 응답 정상: http://127.0.0.1:${PORT}/health"
            have curl && curl -s "http://127.0.0.1:${PORT}/health"; echo
        else
            die "포트는 열렸으나 /health 비정상" "journalctl -u ${SVC_NAME} -n 50 --no-pager 로 로그 확인"
        fi
    else
        die "포트 ${PORT} 미개방 — 서버 기동 실패 추정" "journalctl -u ${SVC_NAME} -n 50 --no-pager"
    fi
else
    log "서비스를 띄운 뒤 검증: curl -s http://127.0.0.1:${PORT}/health"
fi

echo
ok "LLM 서버 셋업 완료"
log "  앱 경로  : ${LLM_DIR} (app.main:app)"
log "  바인드   : ${BIND_ADDR}:${PORT}  ← 중앙서버 .env의 LLM_SERVER_URL이 가리켜야 함"
log "  서비스   : ${SVC_NAME}"
log "  중앙서버 연동 확인: deploy/verify.sh"
