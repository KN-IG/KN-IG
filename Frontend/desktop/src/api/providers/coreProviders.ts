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

// [BACKEND-CONTRACT — 잠정] /api/alerts 응답 형태는 콘솔 UI에 미노출이었으므로
// 필드명을 추정 매핑합니다. P4 실연동 시 실제 응답으로 검증/조정 필요.
interface RawAlert {
  ID?: number | string;
  AgentID?: string;
  Severity?: string;
  Message?: string;
  Resolved?: boolean;
  OccurredAt?: string;
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
      time: fmtTime(r.OccurredAt),
    }));
  },
  async resolve(id) {
    if (config.useMock) {
      const a = MOCK_ALERTS.find((x) => x.id === id);
      if (a) a.resolved = true;
      return;
    }
    const numeric = id.replace(/^ALR-/, "");
    await apiFetch(`/api/alerts/${numeric}/resolve`, { method: "POST" });
  },
};
