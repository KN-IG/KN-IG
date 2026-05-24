// Backend(PascalCase) → UI(camelCase) 정규화.
import type { Agent, FileEvent, AgentStatus, EventType } from "@/types/contracts";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// Backend raw 응답(PascalCase).
export interface RawAgent {
  AgentID: string;
  Hostname?: string;
  IP?: string;
  Status?: string;
  OS?: string;
  MonitorType?: string; // 모니터링 방식 (lkm/ebpf, 추후 LKM310 등으로 세분화 가능)
  Kernel?: string; // 백엔드 추후 제공 시 자동 반영(현재 미제공)
}

export interface RawEvent {
  ID: number | string;
  AgentID: string;
  EventType: string;
  OccurredAt: string;
  FilePath: string;
  Pid?: number;
  DetectedBy?: string;
  Blocked?: boolean; // lock 모드 실제 차단 여부(maintenance/감사 모드 false)
}

// Backend EventType(CREATE/MODIFY/DELETE/ATTRIB/MOVE) → UI 과거형.
export const EVENT_TYPE_MAP: Record<string, EventType> = {
  CREATE: "CREATED",
  MODIFY: "MODIFIED",
  DELETE: "DELETED",
  ATTRIB: "ATTRIB",
  MOVE: "MOVED",
};

export function normalizeAgent(a: RawAgent): Agent {
  return {
    id: a.AgentID,
    hostname: a.Hostname || a.AgentID,
    ip: a.IP || "",
    status: (a.Status || "unknown").toUpperCase() as AgentStatus,
    os: a.OS || "",
    kernel: a.Kernel || "",
    guardian: a.MonitorType || "",
  };
}

export function normalizeEvent(e: RawEvent, agentMap: Record<string, Agent>): FileEvent {
  const a = agentMap[e.AgentID];
  const agentName = (a && a.hostname) || e.AgentID;
  const type = EVENT_TYPE_MAP[e.EventType] ?? e.EventType;
  return {
    id: `EVT-${e.ID}`,
    time: fmtTime(e.OccurredAt),
    agent: agentName,
    agentId: e.AgentID,
    event: `${e.FilePath} ${type}`,
    type,
    action: e.Blocked ? "BLOCKED" : "DETECTED", // lock=차단, maintenance/감사=탐지
    path: e.FilePath,
    pid: e.Pid,
    detectedBy: e.DetectedBy,
  };
}
