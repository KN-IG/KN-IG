// 백엔드 /api/logs 미구현(Non-Goal, 다음 사이클). 콘솔 UI 검증용 합성 mock.
// 실연동 시 logsProvider.ts의 한 줄을 realLogsProvider로 교체합니다.
import type { LogsProvider } from "../types";
import type { SystemLog, AuditLog } from "@/types/contracts";

const SYSTEM_LOGS: SystemLog[] = [
  { id: "SYS-1", time: "2026-05-23 09:12:03", agentId: "agent-01", agent: "web-prod-01", level: "INFO", message: "에이전트가 연결되었습니다." },
  { id: "SYS-2", time: "2026-05-23 09:12:30", agentId: "agent-01", agent: "web-prod-01", level: "INFO", message: "무결성 스캔을 시작합니다." },
  { id: "SYS-3", time: "2026-05-23 09:18:44", agentId: "agent-02", agent: "db-prod-01", level: "WARN", message: "하트비트 응답이 지연되고 있습니다." },
  { id: "SYS-4", time: "2026-05-23 09:25:10", agentId: "agent-02", agent: "db-prod-01", level: "ERROR", message: "에이전트 연결이 끊어졌습니다." },
  { id: "SYS-5", time: "2026-05-23 09:31:02", agentId: "agent-03", agent: "app-stg-01", level: "INFO", message: "스캔이 완료되었습니다. 변경 3건이 감지되었습니다." },
  { id: "SYS-6", time: "2026-05-23 09:45:51", agentId: "agent-01", agent: "web-prod-01", level: "DEBUG", message: "설정을 다시 불러왔습니다." },
];

const AUDIT_LOGS: AuditLog[] = [
  { id: "AUD-1", time: "2026-05-23 08:55:11", actor: "admin", action: "로그인", target: "콘솔 세션", detail: "PIN 인증 성공" },
  { id: "AUD-2", time: "2026-05-23 09:05:40", actor: "admin", action: "정책 배포", target: "web-prod-01", detail: "웹 루트 보호 정책 적용" },
  { id: "AUD-3", time: "2026-05-23 09:40:22", actor: "admin", action: "보고서 생성", target: "EVT-1042", detail: "무결성 위반 보고서" },
  { id: "AUD-4", time: "2026-05-23 10:02:18", actor: "admin", action: "에이전트 삭제", target: "app-old-09", detail: "비활성 에이전트 정리" },
];

export const mockLogsProvider: LogsProvider = {
  async systemLogs() {
    return SYSTEM_LOGS;
  },
  async auditLogs() {
    return AUDIT_LOGS;
  },
};
