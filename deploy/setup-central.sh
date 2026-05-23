#!/usr/bin/env bash
# deploy/setup-central.sh — 중앙 서버 VM 역할 셋업 (멱등, 멀티 디스트로).
#
#   1) Go 설치        (arch 인식 tarball, 이미 있으면 스킵)
#   2) MySQL/MariaDB  (debian=mysql / rhel=mariadb 자동)
#   3) DB/계정/스키마 (멱등: 테이블 카운트 체크, localhost+127.0.0.1 양쪽 계정)
#   4) mTLS 인증서    (CA 보존, 중앙 호스트 SAN 미포함 시에만 server 재서명 → IP변경 안전)
#   5) Backend/.env   (DATABASE_URL/TLS_*/LLM_SERVER_URL)
#   6) go build       (서비스용 바이너리 + 컴파일 사전검증)
#   7) systemd 서비스 + 방화벽
#   8) 검증           (MySQL ping / 포트 / /api/agents)
#
# 사용: ./deploy/setup-central.sh [--no-service] [--regen-certs] [--skip-db]
# cluster.env 의 IG_CENTRAL_HOST/IG_LLM_HOST/IG_DB_*/IG_*_PORT 를 참고한다.

set -euo pipefail
IG_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${IG_DEPLOY_DIR}/lib/common.sh"
ig_enable_errtrap

WITH_SERVICE=1; FORCE_CERTS=0; SKIP_DB=0; IP_OVERRIDE=""; LLM_OVERRIDE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-service) WITH_SERVICE=0; shift ;;
        --regen-certs) FORCE_CERTS=1; shift ;;
        --skip-db) SKIP_DB=1; shift ;;
        --ip) IP_OVERRIDE="${2:-}"; shift 2 ;;          # Agent/콘솔이 접속할 주소(cert SAN). 미지정 시 자기 IP 자동.
        --llm-host) LLM_OVERRIDE="${2:-}"; shift 2 ;;    # LLM 서버 호스트. 미지정 시 127.0.0.1.
        -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
        *) die "알 수 없는 옵션: $1" "사용법은 --help 참고" ;;
    esac
done

ig_load_cluster                                          # cluster.env 있으면 로드(선택)
ig_preflight_common
# 무설정 기본값: 중앙 호스트 = (--ip) > cluster.env > 자기 대표 IP 자동탐지
IG_CENTRAL_HOST="${IP_OVERRIDE:-${IG_CENTRAL_HOST:-$(ig_primary_ip)}}"

BACKEND_DIR="${IG_REPO_ROOT}/Backend"
CERT_DIR="${BACKEND_DIR}/certs"
ENV_FILE="${BACKEND_DIR}/.env"
SCHEMA_FILE="${BACKEND_DIR}/internal/store/schema.sql"
HTTP_PORT="${IG_HTTP_PORT:-8080}"
TCP_PORT="${IG_TCP_PORT:-9000}"
GO_VERSION="${IG_GO_VERSION:-1.25.5}"
DB_NAME="${IG_DB_NAME:-integrityguard}"
DB_USER="${IG_DB_USER:-integrityguard_app}"
DB_PASS="${IG_DB_PASS:-integrityguard}"
LLM_HOST="${LLM_OVERRIDE:-${IG_LLM_HOST:-127.0.0.1}}"
LLM_PORT="${IG_LLM_PORT:-8088}"
LLM_URL="http://${LLM_HOST}:${LLM_PORT}"

[[ -d "$BACKEND_DIR" ]] || die "Backend 디렉토리 없음: $BACKEND_DIR" "저장소 루트에서 실행하세요."
[[ -f "$SCHEMA_FILE" ]] || die "schema.sql 없음: $SCHEMA_FILE"
need openssl
export PATH="$PATH:/usr/local/go/bin"

step "1/8 Go ${GO_VERSION}"
go_arch() {
    case "$(uname -m)" in
        x86_64|amd64) echo amd64 ;;
        aarch64|arm64) echo arm64 ;;
        armv7l|armv6l) echo armv6l ;;
        *) warn "알 수 없는 arch $(uname -m) — amd64로 시도"; echo amd64 ;;
    esac
}
if have go && go version 2>/dev/null | grep -q "go${GO_VERSION} "; then
    ok "Go ${GO_VERSION} 이미 설치됨 — 스킵"
else
    arch="$(go_arch)"
    tarball="go${GO_VERSION}.linux-${arch}.tar.gz"
    log "Go ${GO_VERSION} (${arch}) tarball 설치"
    tmp="$(mktemp)"
    mark "Go tarball 다운로드 실패 — 인터넷/프록시 또는 버전(${GO_VERSION})·arch(${arch}) 확인"
    retry 3 5 -- curl -fsSL "https://go.dev/dl/${tarball}" -o "$tmp"
    $SUDO rm -rf /usr/local/go
    $SUDO tar -C /usr/local -xzf "$tmp"
    rm -f "$tmp"
    echo 'export PATH=$PATH:/usr/local/go/bin' | $SUDO tee /etc/profile.d/go.sh >/dev/null
    $SUDO chmod 644 /etc/profile.d/go.sh
    have go || die "Go 설치 후에도 go 명령 없음" "PATH=/usr/local/go/bin 확인"
    ok "Go 설치: $(go version)"
fi

mysql_service_name() {
    # 유닛 존재 확인 — list-unit-files 텍스트 파싱은 systemd 버전/출력 포맷에 취약해
    # 디스크의 유닛 파일을 직접 확인하고(가장 견고), systemctl cat로 폴백한다.
    local s d
    for s in mysql mariadb mysqld; do
        for d in /usr/lib/systemd/system /lib/systemd/system /etc/systemd/system /run/systemd/system; do
            [[ -f "${d}/${s}.service" ]] && { echo "$s"; return 0; }
        done
        systemctl cat "${s}.service" >/dev/null 2>&1 && { echo "$s"; return 0; }
    done
    echo ""
}
if [[ "$SKIP_DB" -eq 0 ]]; then
    step "2/8 MySQL/MariaDB"
    svc="$(mysql_service_name)"
    if [[ -n "$svc" ]] && systemctl is-active --quiet "$svc"; then
        ok "${svc} 이미 구동 중 — 설치 스킵"
    else
        ig_pkg_refresh
        case "$IG_OS_FAMILY" in
            debian) ig_pkg_install mysql-server ;;
            rhel)   ig_pkg_install mariadb-server mariadb || ig_pkg_install mysql-server ;;
            *) die "지원하지 않는 디스트로에서 DB 자동설치 불가: ${IG_OS_PRETTY}" \
                   "MySQL 8 또는 MariaDB를 수동 설치 후 --skip-db로 재실행하세요." ;;
        esac
        # 설치 직후 유닛이 systemd에 인식되기까지 약간 지연될 수 있어 daemon-reload 후
        # 짧게 재시도한다(첫 설치 타이밍 보강 — 엔진 변경 없음, MySQL 그대로).
        $SUDO systemctl daemon-reload 2>/dev/null || true
        for _ in 1 2 3 4 5; do
            svc="$(mysql_service_name)"
            [[ -n "$svc" ]] && break
            sleep 1
        done
        [[ -n "$svc" ]] || die "DB 서비스 유닛을 찾지 못함" "mysql/mariadb 설치 상태 확인"
        mark "DB 서비스 기동 실패 — systemctl status ${svc}"
        $SUDO systemctl enable --now "$svc"
    fi
    ok "DB 서비스: ${svc:-unknown}"
fi

if [[ "$SKIP_DB" -eq 0 ]]; then
    step "3/8 DB '${DB_NAME}' / 계정 '${DB_USER}' / 스키마"
    mark "MySQL 소켓 관리접속 실패 — root가 비번 인증이면: sudo mysql -u root -p 로 수동 확인"
    $SUDO mysql -e 'SELECT 1' >/dev/null 2>&1 || die "MySQL 관리(소켓) 접속 실패" \
        "대부분 'sudo mysql'은 소켓 인증으로 됩니다. root에 비밀번호가 걸려있다면 일시 해제 후 재실행하세요."

    # 계정은 socket(localhost) + TCP(127.0.0.1) 양쪽 생성 — go-sql-driver는 tcp(127.0.0.1)로 붙음.
    $SUDO mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
    ok "DB/계정 준비 완료 (localhost + 127.0.0.1)"

    # 스키마: schema.sql의 CREATE INDEX는 IF NOT EXISTS 미지원 → 재적용 시 중복오류.
    # 기대 테이블 4개가 모두 있으면 스킵, 아니면 --force로 부족분만 자가치유.
    expected=4
    have_tables="$($SUDO mysql -N -B -e \
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}' AND table_name IN ('agents','file_events','alerts','auth_state');" 2>/dev/null || echo 0)"
    if [[ "$have_tables" == "$expected" ]]; then
        ok "스키마 이미 적용됨(테이블 ${have_tables}/${expected}) — 스킵"
    else
        log "스키마 적용(현재 ${have_tables}/${expected}) — 부족분 생성"
        $SUDO mysql --force "$DB_NAME" < "$SCHEMA_FILE" 2>/dev/null || true
        have_tables="$($SUDO mysql -N -B -e \
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}' AND table_name IN ('agents','file_events','alerts','auth_state');" 2>/dev/null || echo 0)"
        [[ "$have_tables" == "$expected" ]] || die "스키마 적용 실패(${have_tables}/${expected})" \
            "sudo mysql ${DB_NAME} < ${SCHEMA_FILE} 를 수동 실행해 오류를 확인하세요."
        ok "스키마 적용 완료(${have_tables}/${expected})"
    fi

    # 앱 계정 TCP 로그인 검증 (실제 백엔드와 동일 경로)
    if have mysql; then
        if mysql -h 127.0.0.1 -u "$DB_USER" -p"$DB_PASS" -e 'SELECT 1' "$DB_NAME" >/dev/null 2>&1; then
            ok "앱 계정 TCP 로그인 확인 (${DB_USER}@127.0.0.1)"
        else
            warn "앱 계정 TCP 로그인 검증 실패 — 백엔드 기동 시 재확인됩니다."
        fi
    fi
fi

step "4/8 mTLS 인증서 (${CERT_DIR})"
mkdir -p "$CERT_DIR"

# server.crt SAN이 IG_CENTRAL_HOST를 포함하는지
cert_san_covers() {
    local crt="$1" host="$2"
    [[ -f "$crt" ]] || return 1
    openssl x509 -in "$crt" -noout -ext subjectAltName 2>/dev/null | grep -qw "$host" && return 0
    # 구형 openssl은 -ext 미지원 → -text 폴백
    openssl x509 -in "$crt" -noout -text 2>/dev/null | grep -A1 'Subject Alternative Name' | grep -qw "$host"
}

build_san_section() {
    # localhost/127.0.0.1 + IG_CENTRAL_HOST + 추가 SAN을 DNS/IP로 분류해 출력
    local dns_n=1 ip_n=1 h
    echo "subjectAltName=@alt"
    echo "[alt]"
    echo "DNS.${dns_n}=localhost"; dns_n=$((dns_n+1))
    echo "IP.${ip_n}=127.0.0.1";  ip_n=$((ip_n+1))
    for h in "$IG_CENTRAL_HOST" ${IG_CERT_EXTRA_SANS:-}; do
        [[ -z "$h" || "$h" == "localhost" || "$h" == "127.0.0.1" ]] && continue
        if is_ipv4 "$h"; then echo "IP.${ip_n}=${h}"; ip_n=$((ip_n+1))
        else echo "DNS.${dns_n}=${h}"; dns_n=$((dns_n+1)); fi
    done
}

sign_leaf() { # name subj eku
    local name="$1" subj="$2" eku="$3"
    ( cd "$CERT_DIR"
      openssl genrsa -out "${name}.key" 2048 2>/dev/null
      openssl req -new -sha256 -key "${name}.key" -out "${name}.csr" -subj "$subj" 2>/dev/null
      if [[ "$eku" == "serverAuth" ]]; then
          { echo "[v3]"; echo "basicConstraints=CA:FALSE"; echo "keyUsage=digitalSignature,keyEncipherment";
            echo "extendedKeyUsage=serverAuth"; build_san_section; } > "${name}.cnf"
      else
          { echo "[v3]"; echo "basicConstraints=CA:FALSE"; echo "keyUsage=digitalSignature,keyEncipherment";
            echo "extendedKeyUsage=clientAuth"; } > "${name}.cnf"
      fi
      openssl x509 -req -sha256 -days 3650 -in "${name}.csr" -CA ca.crt -CAkey ca.key \
          -CAcreateserial -out "${name}.crt" -extfile "${name}.cnf" -extensions v3 2>/dev/null
      rm -f "${name}.csr" "${name}.cnf"
      chmod 600 "${name}.key"; chmod 644 "${name}.crt" )
}

# CA: 없을 때만 생성(배포된 CA 보존 → agent 재배포 불필요)
if [[ ! -f "${CERT_DIR}/ca.crt" || ! -f "${CERT_DIR}/ca.key" ]]; then
    log "CA 생성"
    ( cd "$CERT_DIR"
      openssl genrsa -out ca.key 2048 2>/dev/null
      openssl req -x509 -new -sha256 -days 3650 -key ca.key -out ca.crt \
          -subj "/CN=KN-IG Legacy Root CA" 2>/dev/null
      chmod 600 ca.key; chmod 644 ca.crt )
    FORCE_CERTS=1   # 새 CA면 leaf도 새로
    warn "새 CA 생성 — 기존 Agent 인증서 모두 무효화(mTLS 거부)."
    hint "새 Backend/certs/{ca,agent}.* 를 각 Agent에 재삽입 후 'kn-ig --agent <중앙IP>' 재실행."
else
    ok "CA 보존(기존 ca.crt 재사용)"
fi

# server: 강제 / 없음 / SAN 미포함 시 재서명
if [[ "$FORCE_CERTS" -eq 1 ]] || [[ ! -f "${CERT_DIR}/server.crt" ]] || ! cert_san_covers "${CERT_DIR}/server.crt" "$IG_CENTRAL_HOST"; then
    log "server 인증서 (재)서명 — SAN: localhost,127.0.0.1,${IG_CENTRAL_HOST} ${IG_CERT_EXTRA_SANS:-}"
    sign_leaf server "/CN=KN-IG Backend" serverAuth
    ok "server.crt 발급"
else
    ok "server.crt SAN이 ${IG_CENTRAL_HOST} 포함 — 재사용"
fi

# agent: 없을 때만(클라이언트 인증서는 SAN 무관, CN/EKU만)
if [[ "$FORCE_CERTS" -eq 1 ]] || [[ ! -f "${CERT_DIR}/agent.crt" ]]; then
    log "agent 클라이언트 인증서 발급(2대 공용)"
    sign_leaf agent "/CN=KN-IG Agent" clientAuth
    ok "agent.crt 발급"
else
    ok "agent.crt 재사용"
fi
rm -f "${CERT_DIR}/ca.srl" 2>/dev/null || true
openssl verify -CAfile "${CERT_DIR}/ca.crt" "${CERT_DIR}/server.crt" >/dev/null && \
openssl verify -CAfile "${CERT_DIR}/ca.crt" "${CERT_DIR}/agent.crt" >/dev/null && \
    ok "인증서 체인 검증 통과" || die "인증서 체인 검증 실패" "--regen-certs 로 전체 재발급하세요."

step "5/8 Backend/.env"
ig_write_atomic "$ENV_FILE" <<EOF
# KN-IG 중앙 서버 설정 — deploy/setup-central.sh 생성 ($(date -u +%FT%TZ))
DATABASE_URL=${DB_USER}:${DB_PASS}@tcp(127.0.0.1:3306)/${DB_NAME}?parseTime=true
HTTP_ADDR=:${HTTP_PORT}
TCP_ADDR=:${TCP_PORT}
TLS_CA=./certs/ca.crt
TLS_CERT=./certs/server.crt
TLS_KEY=./certs/server.key
# LLM 리포트 서버 위치(별도 VM). 미가동이어도 백엔드는 기동되며 리포트만 503→콘솔 mock 폴백.
LLM_SERVER_URL=${LLM_URL}
EOF
chmod 600 "$ENV_FILE" 2>/dev/null || true
ok ".env 작성 — LLM_SERVER_URL=${LLM_URL}"

step "6/8 go build"
mark "go build 실패 — 컴파일 오류 또는 모듈 다운로드(GOPROXY/인터넷) 문제"
( cd "$BACKEND_DIR" && retry 2 5 -- go build -o bin/server ./cmd/server )
[[ -x "${BACKEND_DIR}/bin/server" ]] || die "서버 바이너리 빌드 실패" "cd Backend && go build ./cmd/server 로 오류 확인"
ok "바이너리: ${BACKEND_DIR}/bin/server"

SVC_NAME="kn-ig-central.service"
if [[ "$WITH_SERVICE" -eq 1 ]] && have systemctl; then
    step "7/8 systemd 서비스 (${SVC_NAME})"
    run_user="${SUDO_USER:-$(id -un)}"
    run_group="$(id -gn "$run_user" 2>/dev/null || echo "$run_user")"
    # 바이너리/.env/certs를 서비스 실행 유저가 읽을 수 있게 소유권 정리
    $SUDO chown -R "${run_user}:${run_group}" "${BACKEND_DIR}/bin" "$CERT_DIR" "$ENV_FILE" 2>/dev/null || true
    ig_install_stdin "/etc/systemd/system/${SVC_NAME}" 0644 root:root <<EOF
[Unit]
Description=KN-IG Central Backend (collector + API)
After=network-online.target mysql.service mariadb.service mysqld.service
Wants=network-online.target

[Service]
Type=simple
User=${run_user}
Group=${run_group}
WorkingDirectory=${BACKEND_DIR}
ExecStart=${BACKEND_DIR}/bin/server
Restart=on-failure
RestartSec=3s

[Install]
WantedBy=multi-user.target
EOF
    $SUDO systemctl daemon-reload
    $SUDO systemctl reset-failed "$SVC_NAME" 2>/dev/null || true
    mark "백엔드 기동 실패 — journalctl -u ${SVC_NAME} (DB연결/인증서/포트 확인)"
    $SUDO systemctl enable --now "$SVC_NAME"
    $SUDO systemctl restart "$SVC_NAME"
    ig_open_firewall_port "$HTTP_PORT" tcp
    ig_open_firewall_port "$TCP_PORT" tcp
    ok "서비스 active: $($SUDO systemctl is-active "$SVC_NAME" 2>/dev/null || echo unknown)"
else
    step "7/8 systemd 미사용 — 수동 실행 안내"
    log "  cd ${BACKEND_DIR} && ./bin/server      # 또는 go run ./cmd/server"
    ig_open_firewall_port "$HTTP_PORT" tcp 2>/dev/null || true
    ig_open_firewall_port "$TCP_PORT" tcp 2>/dev/null || true
fi

step "8/8 검증"
if [[ "$WITH_SERVICE" -eq 1 ]] && have systemctl; then
    if wait_tcp 127.0.0.1 "$HTTP_PORT" 30 1; then
        if http_ok "http://127.0.0.1:${HTTP_PORT}/api/agents"; then
            ok "HTTP API 정상: http://127.0.0.1:${HTTP_PORT}/api/agents"
        else
            die "HTTP 포트는 열렸으나 /api/agents 비정상" "journalctl -u ${SVC_NAME} -n 50 --no-pager"
        fi
    else
        die "HTTP ${HTTP_PORT} 미개방 — 백엔드 기동 실패 추정" "journalctl -u ${SVC_NAME} -n 50 --no-pager"
    fi
    tcp_open 127.0.0.1 "$TCP_PORT" 3 && ok "TCP collector :${TCP_PORT} 리슨 확인" \
        || warn "TCP :${TCP_PORT} 미확인 — 방화벽/기동 로그 확인"
    # 중앙→LLM 도달(있으면). 별도 VM이라 아직 미가동일 수 있어 경고만.
    if tcp_open "$LLM_HOST" "$LLM_PORT" 3; then
        http_ok "${LLM_URL}/health" && ok "LLM 서버 도달: ${LLM_URL}/health" \
            || warn "LLM 포트는 열렸으나 /health 비정상 — LLM VM 확인"
    else
        warn "LLM(${LLM_URL}) 미도달 — LLM VM 셋업/방화벽 확인(리포트 외 기능은 정상)"
    fi
fi

echo
ok "중앙 서버 셋업 완료"
log "  바이너리 : ${BACKEND_DIR}/bin/server  (cwd=Backend 필요: .env/certs 상대경로)"
log "  HTTP     : :${HTTP_PORT} (콘솔 REST/SSE)   TCP(mTLS): :${TCP_PORT} (Agent)"
log "  LLM 연동 : ${LLM_URL}"
log "  Agent 배포용 인증서: ${CERT_DIR}/{ca.crt,agent.crt,agent.key}  → setup-agent.sh가 사용"
log "  전체 점검: deploy/verify.sh"
