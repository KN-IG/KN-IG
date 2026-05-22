// 요약 KPI 카드 4종 — 한눈에 시스템 상태 파악.
import { Card, CardContent } from "@/components/ui/card";
import type { DashboardMetric } from "@/types/contracts";

const ITEMS = [
  { key: "agentsOnline", label: "온라인 에이전트", tone: "text-emerald-600 dark:text-emerald-400" },
  { key: "agentsOffline", label: "오프라인 에이전트", tone: "text-rose-600 dark:text-rose-400" },
  { key: "eventsToday", label: "오늘 이벤트", tone: "text-foreground" },
  { key: "openAlerts", label: "미해결 알림", tone: "text-amber-600 dark:text-amber-400" },
] as const;

export function KpiCards({ metric }: { metric: DashboardMetric }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {ITEMS.map((it) => (
        <Card key={it.key} className="glass-surface border-0">
          <CardContent className="p-5">
            <div className="text-[13px] text-muted-foreground">{it.label}</div>
            <div className={`mt-1 text-3xl font-semibold tabular-nums ${it.tone}`}>
              {metric[it.key]}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
