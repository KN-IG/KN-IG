// 데이터 계약 단일 출처 (P3.5).
// 모든 페이지/provider는 이 타입을 통해서만 도메인 데이터에 접근합니다.
// mock provider와 실제 API provider가 동일 인터페이스를 구현하므로,
// 후속 백엔드 사이클(/api/logs·/api/policy)에서 교체가 한 곳에서 끝납니다.

// ── Core (실데이터: /api/agents·/api/events·/api/alerts) ─────────────

export type AgentStatus = "ONLINE" | "OFFLINE" | "UNKNOWN";

export interface Agent {
  id: string;
  hostname: string;
  ip: string;
  status: AgentStatus;
}

// Backend EventType(CREATE/MODIFY/DELETE/ATTRIB/MOVE) → UI 과거형 표기.
export type EventType = "CREATED" | "MODIFIED" | "DELETED" | "ATTRIB" | "MOVED";

export interface FileEvent {
  id: string; // "EVT-{n}"
  time: string; // "YYYY-MM-DD HH:mm:ss"
  agent: string; // hostname (표시용)
  agentId: string;
  event: string; // "{path} {type}"
  type: EventType | string;
  action: string; // 현 agent는 "BLOCKED"만 emit
  path: string;
  pid?: number;
  detectedBy?: string;
}

export type AlertSeverity = "HIGH" | "MEDIUM" | "LOW";

export interface Alert {
  id: string;
  agentId: string;
  agent: string; // hostname (표시용)
  severity: AlertSeverity;
  message: string;
  resolved: boolean;
  time: string;
}

export * from "./logs";
export * from "./policy";
export * from "./dashboard";
