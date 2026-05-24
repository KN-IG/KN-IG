// 대시보드 데이터 훅 — agents/events/alerts를 5초 폴링으로 동기화하고 KPI 집계.
// provider 경유(직접 fetch 금지).
// 폴링 성공/실패는 ConnectionContext로 보고 → Navbar 연결 dot에 반영.
import { useCallback, useEffect, useRef } from "react";
import { usePolling, type PollingState } from "./usePolling";
import { useEventStream } from "./useEventStream";
import { useConnection } from "@/state/ConnectionContext";
import {
  agentsProvider,
  eventsProvider,
  alertsProvider,
} from "../providers/coreProviders";
import type { Agent, FileEvent, Alert, DashboardMetric } from "@/types/contracts";

const POLL_MS = 5000;

export interface DashboardData {
  agents: Agent[];
  events: FileEvent[];
  alerts: Alert[];
  metric: DashboardMetric;
}

function isToday(time: string): boolean {
  // time: "YYYY-MM-DD HH:mm:ss"
  const dt = new Date(time.replace(" ", "T"));
  if (isNaN(dt.getTime())) return false;
  const now = new Date();
  return (
    dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate()
  );
}

function computeMetric(
  agents: Agent[],
  events: FileEvent[],
  alerts: Alert[],
): DashboardMetric {
  const online = agents.filter((a) => a.status === "ONLINE").length;
  return {
    agentsTotal: agents.length,
    agentsOnline: online,
    agentsOffline: agents.length - online,
    eventsToday: events.filter((e) => isToday(e.time)).length,
    openAlerts: alerts.filter((a) => !a.resolved).length,
  };
}

export function useDashboardData(): PollingState<DashboardData> {
  const { setConnected } = useConnection();

  const fetcher = useCallback(async (): Promise<DashboardData> => {
    const [agents, events, alerts] = await Promise.all([
      agentsProvider.list(),
      eventsProvider.list(200),
      // alerts 응답 형태는 잠정 추정(coreProviders) — 실패해도 대시보드는 동작.
      alertsProvider.list().catch(() => [] as Alert[]),
    ]);
    return { agents, events, alerts, metric: computeMetric(agents, events, alerts) };
  }, []);

  const state = usePolling<DashboardData>(fetcher, POLL_MS, setConnected);

  // SSE 이벤트 수신 시 300ms debounce 후 즉시 재조회 — 이벤트/agent 상태를 바로 반영.
  // (5초 폴링은 백업: SSE로 안 오는 변화나 offline 전환 감지용)
  const refetchRef = useRef(state.refetch);
  refetchRef.current = state.refetch;
  const debRef = useRef<number | null>(null);
  useEventStream(() => {
    if (debRef.current !== null) return; // 이미 예약됨 → 이벤트 폭주 시 한 번으로 묶음
    debRef.current = window.setTimeout(() => {
      debRef.current = null;
      void refetchRef.current();
    }, 300);
  });
  useEffect(
    () => () => {
      if (debRef.current !== null) window.clearTimeout(debRef.current);
    },
    [],
  );

  return state;
}
