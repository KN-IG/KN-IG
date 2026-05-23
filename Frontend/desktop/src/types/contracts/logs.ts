// Logs 페이지 계약 — 실시간 에이전트 로그(tail) + 감사 로그.
//
// 사용자 합의: "Logs는 실시간으로 각 Agent의 실제 로그를 받아오는 형식(tail 처럼)".
// 콘솔은 에이전트별 운영 로그 스트림을 tail -f 형태로 따라간다. 백엔드(/api/agents/:id/logs)는
// 미구현이므로 dev에서는 mock provider가 백필 + 신규 라인 push로 스트림을 시뮬레이션한다(provider seam).

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

// 로그 출처(에이전트 서브시스템). 색/필터 보조용 — 에이전트 구조와 정렬(core/inotify/ebpf/scanner/transport/lkm).
export type LogSource =
  | "core"
  | "inotify"
  | "fanotify"
  | "ebpf"
  | "scanner"
  | "transport"
  | "lkm";

// 실시간 에이전트 로그 한 줄(tail). 백엔드 신설 시 SSE 라인으로 대체된다.
export interface AgentLogLine {
  id: string;
  ts: string; // "HH:mm:ss" (tail 가독성 우선)
  agentId: string;
  level: LogLevel;
  source: LogSource;
  message: string;
}

// 감사 로그: 콘솔 사용자 행위 이력(로그인, 정책 변경/배포, 보고서 생성, 에이전트 삭제 등).
export interface AuditLog {
  id: string;
  time: string; // "YYYY-MM-DD HH:mm:ss"
  actor: string; // 행위 주체(사용자/세션 식별)
  action: string; // 수행 동작
  target: string; // 대상 리소스
  detail?: string;
}
