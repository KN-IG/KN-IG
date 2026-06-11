#!/usr/bin/env python3
"""Clear KN-IG report data safely.

By default this clears report runtime data (events, PID chains, alerts) while
preserving console PIN auth, enrollments, certificates and registered agents.

Scopes:
  managed: remove only data created by generate_report_data.py
  events : remove all file events/PID chains/alerts, keep agents/certs/auth
  all    : remove events/alerts/agents/certs/enrollments, keep auth_state only
"""

from __future__ import annotations

import argparse
from textwrap import dedent

from db_common import (
    MANAGED_AGENT_IDS,
    MANAGED_DEV_BASE,
    MANAGED_DEV_RANGE,
    load_db_config,
    print_counts,
    run_mysql_file,
    sql_in,
)


def build_sql(scope: str, reset_auto_increment: bool) -> str:
    managed_event_where = (
        f"target_dev BETWEEN {MANAGED_DEV_BASE} AND {MANAGED_DEV_BASE + MANAGED_DEV_RANGE - 1} "
        f"OR agent_id IN {sql_in(MANAGED_AGENT_IDS)}"
    )
    managed_agent_where = f"agent_id IN {sql_in(MANAGED_AGENT_IDS)}"

    stmts = ["START TRANSACTION;"]
    if scope == "managed":
        stmts.extend([
            f"DELETE FROM file_events WHERE {managed_event_where};",
            f"DELETE FROM alerts WHERE {managed_agent_where};",
            f"DELETE FROM agents WHERE {managed_agent_where};",
        ])
    elif scope == "events":
        stmts.extend([
            "DELETE FROM file_event_process_chain;",
            "DELETE FROM file_events;",
            "DELETE FROM alerts;",
        ])
    elif scope == "all":
        stmts.extend([
            "DELETE FROM file_event_process_chain;",
            "DELETE FROM file_events;",
            "DELETE FROM alerts;",
            "DELETE FROM agent_certificates;",
            "DELETE FROM agents;",
            "DELETE FROM agent_enrollments;",
        ])
    else:
        raise ValueError(scope)
    stmts.append("COMMIT;")

    if reset_auto_increment:
        reset_tables = ["file_event_process_chain", "file_events", "alerts"]
        if scope == "all":
            reset_tables += ["agent_certificates", "agent_enrollments"]
        stmts.extend([f"ALTER TABLE {t} AUTO_INCREMENT = 1;" for t in reset_tables])

    return "\n".join(stmts) + "\n"


def main() -> int:
    p = argparse.ArgumentParser(
        description="KN-IG 리포트 DB 데이터를 삭제합니다. auth_state(콘솔 PIN)는 항상 보존합니다.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=dedent(
            """\
            예시:
              # 추천: 전체 이벤트/체인/알림 초기화, 등록 Agent/인증은 보존
              python3 Backend/scripts/clear_report_data.py --scope events --yes

              # generate_report_data.py가 만든 관리 대상 데이터만 제거
              python3 Backend/scripts/clear_report_data.py --scope managed --yes

              # 완전 운영 데이터 초기화(Agent/인증서/enrollment까지 삭제, PIN만 보존)
              python3 Backend/scripts/clear_report_data.py --scope all --yes --i-understand-delete-agents
            """
        ),
    )
    p.add_argument("--env-file", help="Backend .env 경로. 기본은 KNIG_ENV_FILE 또는 Backend/.env 자동 탐색")
    p.add_argument("--scope", choices=["managed", "events", "all"], default="events")
    p.add_argument("--reset-auto-increment", action="store_true", help="삭제 후 AUTO_INCREMENT를 1로 재설정")
    p.add_argument("--yes", action="store_true", help="실제 삭제 실행")
    p.add_argument(
        "--i-understand-delete-agents",
        action="store_true",
        help="--scope all 사용 시 Agent/인증서/enrollment 삭제를 명시 승인",
    )
    args = p.parse_args()

    if args.yes and args.scope == "all" and not args.i_understand_delete_agents:
        raise SystemExit("--scope all은 Agent/인증서/enrollment를 삭제합니다. --i-understand-delete-agents를 함께 지정하세요.")

    cfg = load_db_config(args.env_file)
    print_counts(cfg, "before")
    sql = build_sql(args.scope, args.reset_auto_increment)
    if not args.yes:
        print("\nDRY-RUN: 실제 삭제는 하지 않았습니다. 실행하려면 --yes를 추가하세요.")
        print(f"계획된 scope={args.scope}")
        return 0
    result = run_mysql_file(cfg, sql)
    if result.returncode != 0:
        raise SystemExit(result.returncode)
    print_counts(cfg, "after")
    print(f"\n삭제 완료(scope={args.scope}). auth_state는 보존했습니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
