// Logs 페이지 계약.
// 사용자 합의(deep-interview R3): "에이전트 동작 로그 + 감사 로그" — 우선 가정,
// 추후 변경 가능(open-questions.md #2). 따라서 타입을 과도하게 좁히지 않습니다.

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

// 에이전트 동작 로그: 연결/해제, 하트비트, 스캔 시작/종료, 에이전트 오류 등 운영 상태.
export interface SystemLog {
  id: string;
  time: string; // "YYYY-MM-DD HH:mm:ss"
  agentId: string;
  agent: string; // hostname (표시용)
  level: LogLevel;
  message: string;
}

// 감사 로그: 콘솔 사용자 행위 이력(로그인, 정책 변경/배포, 보고서 생성, 에이전트 삭제 등).
export interface AuditLog {
  id: string;
  time: string;
  actor: string; // 행위 주체(사용자/세션 식별)
  action: string; // 수행 동작
  target: string; // 대상 리소스
  detail?: string;
}
