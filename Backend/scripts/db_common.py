#!/usr/bin/env python3
"""Shared helpers for KN-IG report data scripts.

The scripts intentionally use only Python stdlib + the local ``mysql`` CLI so
they can run on the central VM without adding dependencies.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


MANAGED_AGENT_IDS = (
    "hmi-line1-01",
    "ews-line1-02",
    "hist-core-03",
    "jump-ops-01",
    "web-ops-01",
)

# Reserved device-number range used only as an internal cleanup marker for
# script-managed events. It is intentionally not shown in report text.
MANAGED_DEV_BASE = 4_242_420_000
MANAGED_DEV_RANGE = 1_000_000


@dataclass(frozen=True)
class DBConfig:
    user: str
    password: str
    host: str
    port: str
    database: str


def backend_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def repo_root() -> Path:
    return backend_dir().parent


def load_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        env[key] = value
    return env


def resolve_env_file(explicit: str | None = None) -> Path:
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit).expanduser())
    if os.getenv("KNIG_ENV_FILE"):
        candidates.append(Path(os.environ["KNIG_ENV_FILE"]).expanduser())
    candidates.extend([
        Path.cwd() / ".env",
        Path.cwd() / "Backend" / ".env",
        backend_dir() / ".env",
        repo_root() / "Backend" / ".env",
    ])
    for path in candidates:
        if path.exists():
            return path
    # Return the canonical path for a useful error message.
    return backend_dir() / ".env"


def load_db_config(explicit_env_file: str | None = None) -> DBConfig:
    env_file = resolve_env_file(explicit_env_file)
    file_env = load_env_file(env_file)
    merged = {**file_env, **os.environ}
    dsn = merged.get("DATABASE_URL", "")
    if not dsn:
        raise SystemExit(f"DATABASE_URL이 없습니다. env 파일 확인: {env_file}")

    # Go MySQL DSN: user:pass@tcp(host:port)/database?params
    m = re.match(
        r"^(?P<user>[^:]+):(?P<pw>.*)@tcp\((?P<host>[^:)]+)(?::(?P<port>\d+))?\)/(?P<db>[^?]+)",
        dsn,
    )
    if not m:
        raise SystemExit("DATABASE_URL 파싱 실패: user:pass@tcp(host:port)/db 형식이어야 합니다.")
    g = m.groupdict()
    return DBConfig(
        user=g["user"],
        password=g["pw"],
        host=g["host"],
        port=g.get("port") or "3306",
        database=g["db"],
    )


def mysql_base_cmd(cfg: DBConfig) -> list[str]:
    mysql = shutil.which("mysql")
    if not mysql:
        raise SystemExit("mysql CLI를 찾을 수 없습니다. 중앙 서버에 mysql client를 설치해 주세요.")
    return [
        mysql,
        "--batch",
        "--raw",
        "--skip-column-names",
        "--default-character-set=utf8mb4",
        "-h",
        cfg.host,
        "-P",
        cfg.port,
        "-u",
        cfg.user,
        cfg.database,
    ]


def run_mysql(cfg: DBConfig, sql: str, *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["MYSQL_PWD"] = cfg.password
    cmd = mysql_base_cmd(cfg)
    if capture:
        return subprocess.run(
            cmd,
            input=sql,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    return subprocess.run(cmd, input=sql, env=env, text=True, check=False)


def run_mysql_file(cfg: DBConfig, sql: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["MYSQL_PWD"] = cfg.password
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as f:
        f.write(sql)
        tmp = f.name
    try:
        cmd = mysql_base_cmd(cfg)
        with open(tmp, "r") as stdin:
            return subprocess.run(cmd, stdin=stdin, env=env, text=True, check=False)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def query_rows(cfg: DBConfig, sql: str) -> list[list[str]]:
    result = run_mysql(cfg, sql, capture=True)
    if result.returncode != 0:
        raise SystemExit(result.stderr.strip() or "mysql query failed")
    rows: list[list[str]] = []
    for line in result.stdout.splitlines():
        if line:
            rows.append(line.split("\t"))
    return rows


def sql_lit(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, datetime):
        value = value.astimezone(timezone.utc).replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S")
    s = str(value)
    s = s.replace("\\", "\\\\").replace("'", "''").replace("\x00", "")
    return f"'{s}'"


def values_tuple(values: Iterable) -> str:
    return "(" + ", ".join(sql_lit(v) for v in values) + ")"


def sql_in(values: Iterable) -> str:
    return "(" + ", ".join(sql_lit(v) for v in values) + ")"


def print_counts(cfg: DBConfig, title: str) -> None:
    sql = f"""
SELECT 'agents', COUNT(*) FROM agents;
SELECT 'managed_agents', COUNT(*) FROM agents WHERE agent_id IN {sql_in(MANAGED_AGENT_IDS)};
SELECT 'events', COUNT(*) FROM file_events;
SELECT 'managed_events', COUNT(*) FROM file_events
  WHERE target_dev BETWEEN {MANAGED_DEV_BASE} AND {MANAGED_DEV_BASE + MANAGED_DEV_RANGE - 1}
     OR agent_id IN {sql_in(MANAGED_AGENT_IDS)};
SELECT 'chain_rows', COUNT(*) FROM file_event_process_chain;
SELECT 'alerts', COUNT(*) FROM alerts;
SELECT 'managed_alerts', COUNT(*) FROM alerts
  WHERE agent_id IN {sql_in(MANAGED_AGENT_IDS)};
"""
    print(f"\n== {title} ==")
    for row in query_rows(cfg, sql):
        if len(row) >= 2:
            print(f"{row[0]}={row[1]}")
