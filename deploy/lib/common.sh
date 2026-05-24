# shellcheck shell=bash
# deploy/lib/common.sh — KN-IG 배포 공통 라이브러리(모든 deploy/ 스크립트가 source).
# 원칙: 멱등 · transient 재시도 · 조기실패+처방 · 원자적 쓰기 · 멀티 디스트로(apt/yum/dnf).

[[ -n "${IG_COMMON_SH_LOADED:-}" ]] && return 0
IG_COMMON_SH_LOADED=1

IG_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IG_DEPLOY_DIR="$(cd "${IG_LIB_DIR}/.." && pwd)"
IG_REPO_ROOT="$(cd "${IG_DEPLOY_DIR}/.." && pwd)"
export IG_LIB_DIR IG_DEPLOY_DIR IG_REPO_ROOT

# 출력 (색상은 TTY일 때만)
if [[ -t 1 ]]; then
    _C_RST=$'\033[0m'; _C_DIM=$'\033[2m'; _C_RED=$'\033[31m'
    _C_GRN=$'\033[32m'; _C_YLW=$'\033[33m'; _C_BLU=$'\033[34m'; _C_BLD=$'\033[1m'
else
    _C_RST=''; _C_DIM=''; _C_RED=''; _C_GRN=''; _C_YLW=''; _C_BLU=''; _C_BLD=''
fi

log()  { printf '%s[*]%s %s\n' "$_C_BLU" "$_C_RST" "$*"; }
ok()   { printf '%s[+]%s %s\n' "$_C_GRN" "$_C_RST" "$*"; }
warn() { printf '%s[!]%s %s\n' "$_C_YLW" "$_C_RST" "$*" >&2; }
step() { printf '\n%s[>]%s %s%s%s\n' "$_C_BLU" "$_C_RST" "$_C_BLD" "$*" "$_C_RST"; }
hint() { printf '%s    ↳ %s%s\n' "$_C_DIM" "$*" "$_C_RST" >&2; }
die() {
    local msg="$1"; shift || true
    printf '%s[x] %s%s\n' "$_C_RED" "$msg" "$_C_RST" >&2
    while [[ $# -gt 0 ]]; do hint "$1"; shift; done
    exit 1
}

# ERR trap: 위험 단계 직전 mark "처방"으로 힌트 예약 → ig_enable_errtrap 로 활성화
IG_LAST_HINT=""
mark() { IG_LAST_HINT="$*"; }
_ig_on_err() {
    local rc=$1 line=$2 cmd=$3
    printf '%s[x] 예상치 못한 실패 (exit=%s) — %s:%s%s\n' \
        "$_C_RED" "$rc" "${BASH_SOURCE[1]:-?}" "$line" "$_C_RST" >&2
    printf '%s    실패한 명령: %s%s\n' "$_C_DIM" "$cmd" "$_C_RST" >&2
    [[ -n "$IG_LAST_HINT" ]] && hint "$IG_LAST_HINT"
    hint "멱등합니다 — 원인을 고친 뒤 같은 명령을 다시 실행하세요."
    exit "$rc"
}
ig_enable_errtrap() { set -E; trap '_ig_on_err "$?" "$LINENO" "$BASH_COMMAND"' ERR; }

have() { command -v "$1" >/dev/null 2>&1; }
need() { have "$1" || die "필수 명령 없음: $1" "패키지 설치 후 다시 실행하세요."; }

# SUDO: root면 빈 문자열, 아니면 sudo
ig_init_sudo() {
    if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then SUDO=""
    elif have sudo; then SUDO="sudo"
    else die "root 권한 필요 — sudo도 없음" "root로 실행하거나 sudo를 설치하세요."; fi
    export SUDO
}

# retry [횟수] [초기지연] -- cmd...  (지수 backoff; 마지막 실패 시 비정상 반환)
retry() {
    local tries=3 delay=3
    [[ "$1" =~ ^[0-9]+$ ]] && { tries=$1; shift; }
    [[ "$1" =~ ^[0-9]+$ ]] && { delay=$1; shift; }
    [[ "${1:-}" == "--" ]] && shift
    local n=1
    while true; do
        if "$@"; then return 0; fi
        if (( n >= tries )); then
            warn "재시도 ${tries}회 모두 실패: $*"
            return 1
        fi
        warn "실패(${n}/${tries}) — ${delay}s 후 재시도: $*"
        sleep "$delay"
        delay=$(( delay * 2 ))
        n=$(( n + 1 ))
    done
}

# OS 감지 → IG_OS_FAMILY(debian|rhel) IG_PKG(apt|dnf|yum) IG_OS_ID/VER/PRETTY
ig_detect_os() {
    [[ "$(uname -s)" == "Linux" ]] || die "Linux 전용 — 현재: $(uname -s)" \
        "이 스크립트는 대상 VM(Linux) 위에서 실행해야 합니다."
    IG_OS_ID="unknown"; IG_OS_VER=""; IG_OS_PRETTY="unknown"
    if [[ -r /etc/os-release ]]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        IG_OS_ID="${ID:-unknown}"
        IG_OS_VER="${VERSION_ID:-}"
        IG_OS_PRETTY="${PRETTY_NAME:-$IG_OS_ID}"
    fi
    case "$IG_OS_ID" in
        ubuntu|debian|linuxmint|pop) IG_OS_FAMILY="debian" ;;
        centos|rhel|rocky|almalinux|fedora|ol|amzn) IG_OS_FAMILY="rhel" ;;
        *)
            if [[ "${ID_LIKE:-}" == *debian* ]]; then IG_OS_FAMILY="debian"
            elif [[ "${ID_LIKE:-}" == *rhel* || "${ID_LIKE:-}" == *fedora* ]]; then IG_OS_FAMILY="rhel"
            else IG_OS_FAMILY="unknown"; fi ;;
    esac
    if   have apt-get; then IG_PKG="apt"
    elif have dnf;     then IG_PKG="dnf"
    elif have yum;     then IG_PKG="yum"
    else IG_PKG="none"; fi
    [[ "$IG_OS_FAMILY" == "unknown" || "$IG_PKG" == "none" ]] && \
        warn "디스트로 자동감지 실패(${IG_OS_PRETTY}) — apt/yum 미지원일 수 있습니다."
    export IG_OS_FAMILY IG_PKG IG_OS_ID IG_OS_VER IG_OS_PRETTY
}

# 패키지 인덱스 갱신 (멱등, 하루 1회)
ig_pkg_refresh() {
    case "$IG_PKG" in
        apt)
            local stamp=/var/lib/apt/periodic/update-success-stamp
            if [[ -f "$stamp" ]] && [[ $(( $(date +%s) - $(stat -c %Y "$stamp" 2>/dev/null || echo 0) )) -lt 86400 ]]; then
                return 0
            fi
            retry 3 5 -- $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq ;;
        dnf) retry 3 5 -- $SUDO dnf -q makecache 2>/dev/null || true ;;
        yum) retry 3 5 -- $SUDO yum -q makecache 2>/dev/null || true ;;
    esac
}

# 패키지 설치 (멱등, 재시도; 패키지명은 호출자가 디스트로별 매핑)
ig_pkg_install() {
    [[ $# -gt 0 ]] || return 0
    case "$IG_PKG" in
        apt) retry 3 5 -- $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" ;;
        dnf) retry 3 5 -- $SUDO dnf install -y "$@" ;;
        yum) retry 3 5 -- $SUDO yum install -y "$@" ;;
        *)   die "패키지 매니저 없음 — 수동 설치 필요: $*" ;;
    esac
}

# 커널 family: 5.8+ eBPF · 3.10~5.7 LKM · 그 외 inotify(폴백)
ig_kver() { uname -r | sed -E 's/^([0-9]+\.[0-9]+).*/\1/'; }
kver_ge() {  # A >= B (major.minor)
    local a_major="${1%%.*}" a_minor="${1##*.}"
    local b_major="${2%%.*}" b_minor="${2##*.}"
    (( a_major > b_major )) && return 0
    (( a_major < b_major )) && return 1
    (( a_minor >= b_minor ))
}
ig_agent_backend() {
    local kv; kv="$(ig_kver)"
    if kver_ge "$kv" "5.8"; then echo "ebpf"
    elif kver_ge "$kv" "3.10"; then echo "lkm"
    else echo "inotify"; fi
}

# 원자적 설치: stdin→dest(root, 부모 자동생성).  ig_install_stdin <dest> <mode> [owner:group]
ig_install_stdin() {
    local dest="$1" mode="${2:-0644}" owner="${3:-root:root}"
    local tmp; tmp="$(mktemp)"
    cat > "$tmp"
    $SUDO install -D -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$tmp" "$dest"
    rm -f "$tmp"
}
# 비권한 원자적 쓰기: temp→mv.  ig_write_atomic <dest>
ig_write_atomic() {
    local dest="$1"
    local dir; dir="$(dirname "$dest")"
    mkdir -p "$dir"
    local tmp; tmp="$(mktemp "${dir}/.ig.XXXXXX")"
    cat > "$tmp"
    mv -f "$tmp" "$dest"
}

is_ipv4() { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; }

# TCP 포트 열림 확인 (nc 우선, 폴백 /dev/tcp)
tcp_open() {
    local host="$1" port="$2" timeout="${3:-3}"
    if have nc; then
        nc -z -w "$timeout" "$host" "$port" >/dev/null 2>&1
    else
        timeout "$timeout" bash -c ">/dev/tcp/${host}/${port}" >/dev/null 2>&1
    fi
}
# HTTP 2xx 확인
http_ok() {
    local url="$1" timeout="${2:-5}"
    have curl || return 2
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time "$timeout" "$url" 2>/dev/null || echo 000)"
    [[ "$code" =~ ^2 ]]
}
# 포트 열릴 때까지 대기
wait_tcp() {
    local host="$1" port="$2" tries="${3:-30}" sleep_s="${4:-2}"
    local i=1
    while (( i <= tries )); do
        tcp_open "$host" "$port" 2 && return 0
        sleep "$sleep_s"; i=$(( i + 1 ))
    done
    return 1
}

# cluster.env 선택적 로드 (있으면 덮어쓰기용, 없으면 조용히 진행)
ig_load_cluster() {
    local f="${IG_CLUSTER_ENV:-${IG_DEPLOY_DIR}/cluster.env}"
    if [[ -f "$f" ]]; then
        # shellcheck disable=SC1090
        set -a; . "$f"; set +a
        IG_CLUSTER_ENV_USED="$f"
    else
        IG_CLUSTER_ENV_USED=""
    fi
    export IG_CLUSTER_ENV_USED
    return 0
}

# 자기 대표 IP 자동탐지 (폐쇄망 OK — 라우팅 테이블만 조회)
ig_primary_ip() {
    local ip=""
    if have ip; then
        ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1);exit}}')"
    fi
    [[ -z "$ip" ]] && ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    [[ -z "$ip" ]] && ip="127.0.0.1"
    printf '%s' "$ip"
}

# 방화벽 포트 개방 (best-effort, 멱등, 비치명)
ig_open_firewall_port() {
    local port="$1" proto="${2:-tcp}"
    if have ufw && $SUDO ufw status 2>/dev/null | grep -qi '^Status: active'; then
        $SUDO ufw allow "${port}/${proto}" >/dev/null 2>&1 && \
            ok "ufw: ${port}/${proto} 허용" || warn "ufw 규칙 추가 실패(무시) ${port}/${proto}"
    elif have firewall-cmd && $SUDO firewall-cmd --state >/dev/null 2>&1; then
        $SUDO firewall-cmd --permanent --add-port="${port}/${proto}" >/dev/null 2>&1 || true
        $SUDO firewall-cmd --reload >/dev/null 2>&1 && \
            ok "firewalld: ${port}/${proto} 허용" || warn "firewalld 규칙 추가 실패(무시) ${port}/${proto}"
    else
        log "활성 방화벽 미감지 — 포트 개방 생략 (${port}/${proto}). 클라우드 보안그룹은 별도 확인 필요."
    fi
    return 0
}

# 공통 preflight
ig_preflight_common() {
    ig_detect_os
    ig_init_sudo
    log "환경: ${IG_OS_PRETTY} (family=${IG_OS_FAMILY}, pkg=${IG_PKG}, kernel=$(uname -r), arch=$(uname -m))"
}
