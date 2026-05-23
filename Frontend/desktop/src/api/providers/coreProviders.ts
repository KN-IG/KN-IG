// 실데이터 provider (agents/events/alerts) — apiFetch + normalize 래핑.
// P4 폴링 훅이 이 provider를 소비합니다(직접 fetch 대신).
// config.useMock(dev)일 때는 백엔드 호출 없이 mockCore 데이터를 반환합니다.
import { config } from "../../config";
import { apiFetch } from "../client";
import {
  normalizeAgent,
  normalizeEvent,
  fmtTime,
  type RawAgent,
  type RawEvent,
} from "../normalize";
import type { Agent, Alert } from "@/types/contracts";
import type { AgentsProvider, EventsProvider, AlertsProvider } from "./types";
import { MOCK_AGENTS, MOCK_EVENTS, MOCK_ALERTS } from "./mock/mockCore";

export const agentsProvider: AgentsProvider = {
  async list() {
    if (config.useMock) return MOCK_AGENTS;
    const res = await apiFetch("/api/agents");
    const raw = (await res.json()) as RawAgent[];
    return Array.isArray(raw) ? raw.map(normalizeAgent) : [];
  },
};

export const eventsProvider: EventsProvider = {
  async list(limit = 200) {
    if (config.useMock) return MOCK_EVENTS.slice(0, limit);
    const [agentsRes, eventsRes] = await Promise.all([
      apiFetch("/api/agents"),
      apiFetch(`/api/events?limit=${limit}`),
    ]);
    const rawAgents = (await agentsRes.json()) as RawAgent[];
    const rawEvents = (await eventsRes.json()) as RawEvent[];
    const agentMap: Record<string, Agent> = {};
    for (const a of Array.isArray(rawAgents) ? rawAgents : []) {
      const n = normalizeAgent(a);
      agentMap[n.id] = n;
    }
    return Array.isArray(rawEvents)
      ? rawEvents.map((e) => normalizeEvent(e, agentMap))
      : [];
  },
};

// /api/alerts 응답은 Backend internal.Alert 구조체를 json 태그 없이 직렬화한 것이라
// 키가 Go 필드명 그대로다(interfaces.go: ID/AgentID/Severity/Message/Resolved/CreatedAt).
interface RawAlert {
  ID?: number | string;
  AgentID?: string;
  Severity?: string;
  Message?: string;
  Resolved?: boolean;
  CreatedAt?: string;
}

export const alertsProvider: AlertsProvider = {
  async list() {
    if (config.useMock) return MOCK_ALERTS;
    const res = await apiFetch("/api/alerts");
    const raw = (await res.json()) as RawAlert[];
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => ({
      id: `ALR-${r.ID ?? ""}`,
      agentId: r.AgentID ?? "",
      agent: r.AgentID ?? "",
      severity: (r.Severity || "LOW").toUpperCase() as Alert["severity"],
      message: r.Message ?? "",
      resolved: Boolean(r.Resolved),
      time: fmtTime(r.CreatedAt),
    }));
  },
  async resolve(id) {
    if (config.useMock) {
      const a = MOCK_ALERTS.find((x) => x.id === id);
      if (a) a.resolved = true;
      return;
    }
    const numeric = id.replace(/^ALR-/, "");
    // Backend 라우트는 PATCH /api/alerts/:id/resolve (server.go).
    await apiFetch(`/api/alerts/${numeric}/resolve`, { method: "PATCH" });
  },
};
