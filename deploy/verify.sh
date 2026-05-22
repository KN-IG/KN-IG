#!/usr/bin/env bash
# deploy/verify.sh — KN-IG 클러스터 검증 (PASS/FAIL 매트릭스).
#
# 콘솔 PIN 인증이 항상 켜져 있어 /api/* 는 Bearer 토큰이 필요합니다. 따라서 이 무인증
# 검증은 생존·도달·인증게이트·LLM 까지 확인하고, 에이전트/이벤트/리포트처럼 인증 뒤
# 데이터는 콘솔(로그인) 또는 토큰으로 확인합니다.
#
# 점검: [중앙] /auth/status 200 · /api 401(인증 활성) · TCP :9000
#       [LLM ] /health · /v1/reports/summary 라운드트립
#
# 사용: ./deploy/verify.sh [--event-test]
#   --event-test : 첫 Agent에 SSH로 보호파일 쓰기를 유발(이벤트 발생). 결과는 콘솔/journalctl 확인.

set -uo pipefail   # -e 미사용: 모든 점검을 끝까지 돌려 집계한다
IG_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${IG_DEPLOY_DIR}/lib/common.sh"

EVENT_TEST=0
[[ "${1:-}" == "--event-test" ]] && EVENT_TEST=1
[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { sed -n '2,13p' "$0"; exit 0; }

ig_load_cluster

HTTP_PORT="${IG_HTTP_PORT:-8080}"
TCP_PORT="${IG_TCP_PORT:-9000}"
LLM_PORT="${IG_LLM_PORT:-8088}"
CENTRAL="${IG_CENTRAL_HOST:-127.0.0.1}"
LLM_HOST="${IG_LLM_HOST:-127.0.0.1}"
API="http://${CENTRAL}:${HTTP_PORT}"
LLM="http://${LLM_HOST}:${LLM_PORT}"
SAMPLE="${IG_REPO_ROOT}/LLM/sample_request.json"

PASS=0; FAIL=0; WARN=0
P() { printf '  %s✓%s %s\n' "$_C_GRN" "$_C_RST" "$*"; PASS=$((PASS+1)); }
F() { printf '  %s✗%s %s\n' "$_C_RED" "$_C_RST" "$*"; FAIL=$((FAIL+1)); }
W() { printf '  %s!%s %s\n' "$_C_YLW" "$_C_RST" "$*"; WARN=$((WARN+1)); }

http_code() { local c; c="$(curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-8}" "$1" 2>/dev/null)"; echo "${c:-000}"; }
post_code() { # url [datafile]
    local c
    if [[ -n "${2:-}" && -f "$2" ]]; then
        c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 70 -X POST -H 'content-type: application/json' --data @"$2" "$1" 2>/dev/null)"
    else
        c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 70 -X POST "$1" 2>/dev/null)"
    fi
    echo "${c:-000}"
}

printf '%s━━ KN-IG 클러스터 검증 ━━%s  (%s)\n' "$_C_BLD" "$_C_RST" "${IG_CLUSTER_ENV_USED:-로컬 기본값}"
printf '  중앙=%s  LLM=%s  Agent=[%s]\n' "$CENTRAL" "$LLM_HOST" "${IG_AGENT_HOSTS:-등록목록}"
need curl

step "1) 중앙 서버"
code="$(http_code "${API}/auth/status")"
if [[ "$code" =~ ^2 ]]; then P "HTTP API+인증 정상 (${API}/auth/status → ${code})"
else F "HTTP API 비정상 (${API}/auth/status → ${code}) — 백엔드 기동/방화벽(${HTTP_PORT}) 확인"; fi

acode="$(http_code "${API}/api/agents")"
case "$acode" in
    401) P "API 인증 활성 (/api → 401, 정상)" ;;
    2*)  W "주의: /api 가 무인증 접근됨 (${acode}) — 인증 미적용 의심" ;;
    000) : ;;   # 중앙 미도달은 위에서 이미 F 처리
    *)   W "/api 응답 ${acode} (점검 참고)" ;;
esac

if tcp_open "$CENTRAL" "$TCP_PORT" 5; then P "TCP collector 리슨 (${CENTRAL}:${TCP_PORT})"
else F "TCP collector 미응답 (${CENTRAL}:${TCP_PORT}) — Agent가 붙지 못함. 방화벽/기동 확인"; fi

step "2) LLM 서버"
code="$(http_code "${LLM}/health")"
if [[ "$code" =~ ^2 ]]; then
    P "/health 응답 (${LLM}/health → ${code})"
    if have jq; then
        conf="$(curl -s --max-time 8 "${LLM}/health" 2>/dev/null | jq -r '.llm_provider_configured' 2>/dev/null)"
        [[ "$conf" == "true" ]] && log "    제공자 키 설정됨(LLM 서술)" || log "    제공자 키 없음 → 템플릿 서술 폴백(정상)"
    fi
else F "/health 비정상 (${LLM}/health → ${code}) — LLM VM 기동/방화벽(${LLM_PORT}) 확인"; fi

rc="$(post_code "${LLM}/v1/reports/summary" "$SAMPLE")"
if [[ "$rc" =~ ^2 ]]; then P "리포트 라운드트립 (POST /v1/reports/summary → ${rc})"
elif [[ "$rc" == "000" ]]; then W "리포트 라운드트립 미수행 (LLM 미도달 또는 sample 없음: $SAMPLE)"
else F "리포트 라운드트립 실패 (→ ${rc})"; fi

step "3) 인증 뒤 데이터 (콘솔에서 확인)"
log "에이전트 등록·이벤트 흐름·리포트 생성은 /api 인증(콘솔 PIN 로그인) 뒤에 있습니다."
log "  콘솔 로그인 후 대시보드에서 Agent/Events 확인. 또는 서버에서 토큰으로:"
log "    TOKEN=\$(curl -s -XPOST ${API}/auth/login -H 'content-type: application/json' -d '{\"pin\":\"<PIN>\"}' | jq -r .token)"
log "    curl -s ${API}/api/agents -H \"Authorization: Bearer \$TOKEN\" | jq ."

if [[ "$EVENT_TEST" -eq 1 ]]; then
    first_ssh="$(echo "${IG_AGENT_SSH:-}" | awk '{print $1}')"
    if [[ -z "$first_ssh" ]]; then
        W "--event-test: IG_AGENT_SSH 없음 — 능동 유발 생략"
    else
        log "능동 유발: ${first_ssh} 에서 보호파일 쓰기 (/etc/skel/.bashrc)"
        ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 "$first_ssh" \
            'sudo bash -c "echo \"# kn-ig verify $(date +%s)\" >> /etc/skel/.bashrc" 2>/dev/null; true' >/dev/null 2>&1 \
            || W "SSH 유발 실패(권한/접속) — 수동 확인 필요"
        log "→ 발생 이벤트는 콘솔 대시보드 또는 'journalctl -u integrityguard.service' 에서 확인하세요."
    fi
fi

echo
printf '%s━━ 결과 ━━%s  PASS=%s%d%s  FAIL=%s%d%s  WARN=%s%d%s\n' \
    "$_C_BLD" "$_C_RST" "$_C_GRN" "$PASS" "$_C_RST" "$_C_RED" "$FAIL" "$_C_RST" "$_C_YLW" "$WARN" "$_C_RST"
if [[ "$FAIL" -gt 0 ]]; then
    hint "FAIL 항목의 처방을 따라 해당 VM에서 kn-ig 를 재실행(멱등)하세요."
    exit 1
fi
ok "클러스터 핵심(생존·인증·LLM) 검증 통과 — 데이터 흐름은 콘솔에서 확인"
exit 0
