#!/usr/bin/env bash
# deploy/verify.sh — KN-IG 클러스터 end-to-end 검증 (PASS/FAIL 매트릭스).
#
# "실제 작동까지" 를 증명하는 주체. HOST(제어 PC) 또는 임의 VM에서 실행 가능하며,
# cluster.env 의 호스트로 네트워크를 통해 각 컴포넌트를 점검한다.
#
# 점검 항목:
#   [중앙] HTTP /api/agents 200, TCP collector 리슨
#   [LLM ] /health, /v1/reports/summary 라운드트립
#   [연동] 중앙 → LLM (중앙의 /api/reports/summary 200 = 실제 링크 증명)
#   [에이전트] 각 Agent가 /api/agents에 online + IP/monitor_type 일치
#   [이벤트] 최근 file_events 존재 여부(정보), --event-test로 능동 유발 가능
#
# 사용: ./deploy/verify.sh [--event-test]
#   --event-test : 첫 Agent에 SSH로 보호파일 쓰기를 유발해 이벤트 흐름까지 증명
#                  (cluster.env의 IG_AGENT_SSH 필요)

set -uo pipefail   # -e 미사용: 모든 점검을 끝까지 돌려 집계한다
IG_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${IG_DEPLOY_DIR}/lib/common.sh"

EVENT_TEST=0
[[ "${1:-}" == "--event-test" ]] && EVENT_TEST=1
[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { sed -n '2,20p' "$0"; exit 0; }

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
code="$(http_code "${API}/api/agents")"
if [[ "$code" =~ ^2 ]]; then P "HTTP API 응답 (${API}/api/agents → ${code})"
else F "HTTP API 비정상 (${API}/api/agents → ${code}) — 백엔드 기동/방화벽(${HTTP_PORT}) 확인"; fi

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

step "3) 중앙 → LLM 연동"
rc="$(post_code "${API}/api/reports/summary")"
case "$rc" in
    2*)  P "중앙이 LLM 호출 성공 (${API}/api/reports/summary → ${rc})" ;;
    503) F "중앙이 LLM에 도달 못함 (503) — 중앙 .env의 LLM_SERVER_URL=${LLM} 및 LLM VM 기동 확인" ;;
    000) F "중앙 API 미도달 (연동 점검 불가)" ;;
    *)   W "중앙 리포트 응답 ${rc} (DB 비어있으면 정상일 수 있음)" ;;
esac

step "4) 에이전트 등록 (/api/agents)"
agents_json="$(curl -s --max-time 8 "${API}/api/agents" 2>/dev/null || echo '')"
if ! have jq; then
    W "jq 미설치 — 에이전트 점검 생략(원시 응답): $(printf '%.120s' "$agents_json")"
elif [[ -z "${IG_AGENT_HOSTS:-}" ]]; then
    # per-VM 모델(cluster.env 없음) — 등록된 에이전트를 그대로 나열
    n="$(printf '%s' "$agents_json" | jq 'if type=="array" then length else 0 end' 2>/dev/null || echo 0)"
    if [[ "$n" =~ ^[1-9] ]]; then
        P "등록된 에이전트 ${n}대:"
        printf '%s' "$agents_json" | jq -r '.[]? | "      - \(.IP)  \(.Status)  (\(.MonitorType), id=\(.AgentID))"' 2>/dev/null
    else
        W "등록된 에이전트 0대 — 각 Agent에서 'kn-ig --agent <중앙IP>' 실행/인증서/TCP(${TCP_PORT}) 확인"
    fi
else
    for ip in $IG_AGENT_HOSTS; do
        st="$(printf '%s' "$agents_json" | jq -r --arg ip "$ip" '.[]? | select(.IP==$ip) | .Status' 2>/dev/null | head -1)"
        mt="$(printf '%s' "$agents_json" | jq -r --arg ip "$ip" '.[]? | select(.IP==$ip) | .MonitorType' 2>/dev/null | head -1)"
        aid="$(printf '%s' "$agents_json" | jq -r --arg ip "$ip" '.[]? | select(.IP==$ip) | .AgentID' 2>/dev/null | head -1)"
        if [[ "$st" == "online" ]]; then P "Agent ${ip}: online (id=${aid}, monitor=${mt})"
        elif [[ -n "$st" ]]; then W "Agent ${ip}: 등록됨이나 상태=${st} (재연결 대기/오프라인)"
        else F "Agent ${ip}: 미등록 — setup-agent.sh 실행/인증서/TCP(${TCP_PORT}) 도달 확인"; fi
    done
fi

step "5) 이벤트 흐름 (/api/events)"
ev_count() {
    local body; body="$(curl -s --max-time 8 "${API}/api/events?limit=50" 2>/dev/null)"
    [[ -z "$body" ]] && { echo "?"; return; }
    if have jq; then printf '%s' "$body" | jq 'if type=="array" then length else 0 end' 2>/dev/null || echo "?"
    else echo "?"; fi
}
before="$(ev_count)"
log "현재 최근 이벤트 수(≤50): ${before}"

if [[ "$EVENT_TEST" -eq 1 ]]; then
    first_ssh="$(echo "${IG_AGENT_SSH:-}" | awk '{print $1}')"
    if ! have jq; then
        W "--event-test: jq 미설치 — 이벤트 수 정량 비교 불가(이벤트 흐름 증명 생략). jq 설치 권장."
    elif [[ -z "$first_ssh" ]]; then
        W "--event-test: IG_AGENT_SSH 없음 — 능동 유발 생략"
    else
        log "능동 유발: ${first_ssh} 에서 보호파일 쓰기 시도 (/etc/skel/.bashrc)"
        ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 "$first_ssh" \
            'sudo bash -c "echo \"# kn-ig verify $(date +%s)\" >> /etc/skel/.bashrc" 2>/dev/null; true' >/dev/null 2>&1 || \
            W "SSH 유발 실패(권한/접속) — 수동 확인 필요"
        sleep 4
        after="$(ev_count)"
        if [[ "$before" =~ ^[0-9]+$ && "$after" =~ ^[0-9]+$ && "$after" -gt "$before" ]]; then
            P "이벤트 흐름 확인 (${before} → ${after})"
        else
            W "이벤트 증가 미확인 (${before} → ${after}) — lock 모드면 차단되며 AUDIT 로그/지연 가능. journalctl 확인"
        fi
    fi
else
    [[ "$before" =~ ^[1-9] ]] && P "이벤트 존재(${before}) — 파이프라인 동작 흔적" \
        || log "이벤트 0건(파일 활동 전이면 정상). 흐름까지 보려면: $0 --event-test"
fi

echo
printf '%s━━ 결과 ━━%s  PASS=%s%d%s  FAIL=%s%d%s  WARN=%s%d%s\n' \
    "$_C_BLD" "$_C_RST" "$_C_GRN" "$PASS" "$_C_RST" "$_C_RED" "$FAIL" "$_C_RST" "$_C_YLW" "$WARN" "$_C_RST"
if [[ "$FAIL" -gt 0 ]]; then
    hint "FAIL 항목의 처방을 따라 해당 VM에서 setup-*.sh 를 재실행(멱등)하세요."
    exit 1
fi
ok "클러스터 핵심 검증 통과"
exit 0
