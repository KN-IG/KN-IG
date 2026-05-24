// 대시보드 — KPI + 추세 차트 + 에이전트(드릴다운) + 이벤트 테이블.
// 5초 폴링(useDashboardData) + 연결 상태 보고(ConnectionContext).
import { useState } from "react";
import { useDashboardData } from "@/api/hooks/useDashboardData";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { TrendCharts } from "@/components/dashboard/TrendCharts";
import { AgentTable } from "@/components/dashboard/AgentTable";
import { AgentDrilldown } from "@/components/dashboard/AgentDrilldown";
import { EventTable } from "@/components/dashboard/EventTable";
import { Skeleton } from "@/components/ui/skeleton";
import type { Agent, DashboardMetric } from "@/types/contracts";

const EMPTY_METRIC: DashboardMetric = {
  agentsTotal: 0,
  agentsOnline: 0,
  agentsOffline: 0,
  eventsToday: 0,
  openAlerts: 0,
};

export default function Dashboard() {
  const { data, loading, error } = useDashboardData();
  const [selected, setSelected] = useState<Agent | null>(null);

  if (loading && !data) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  }

  const d = data ?? { agents: [], events: [], alerts: [], metric: EMPTY_METRIC };

  return (
    <div className="flex flex-col gap-6">
      {error && !data && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          데이터를 불러오지 못했습니다. Central Server 연결을 확인해 주십시오.
        </div>
      )}
      <KpiCards metric={d.metric} />
      <TrendCharts events={d.events} />
      <AgentTable agents={d.agents} onSelect={setSelected} />
      <EventTable events={d.events} agents={d.agents} />
      <AgentDrilldown
        agent={selected}
        events={d.events}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </div>
  );
}
