// 추세 차트(recharts) — 시간대별 이벤트 추이 + 유형 분포.
// 색은 hsl(var(--chart-N)) 토큰 직접 참조 → 테마(.dark) 변경 시 CSS 변수로 자동 재채색
// (getComputedStyle/remount 불필요).
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FileEvent } from "@/types/contracts";

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const TOOLTIP_STYLE = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
  color: "hsl(var(--popover-foreground))",
} as const;

function hourlyBuckets(events: FileEvent[]): { hour: string; count: number }[] {
  const buckets = new Map<string, number>();
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3_600_000);
    buckets.set(`${String(d.getHours()).padStart(2, "0")}시`, 0);
  }
  for (const e of events) {
    const dt = new Date(e.time.replace(" ", "T"));
    if (isNaN(dt.getTime())) continue;
    const key = `${String(dt.getHours()).padStart(2, "0")}시`;
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return Array.from(buckets, ([hour, count]) => ({ hour, count }));
}

function typeDistribution(events: FileEvent[]): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    const t = String(e.type);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return Array.from(counts, ([type, count]) => ({ type, count }));
}

export function TrendCharts({ events }: { events: FileEvent[] }) {
  const trend = hourlyBuckets(events);
  const dist = typeDistribution(events);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="glass-surface border-0">
        <CardHeader>
          <CardTitle className="text-base">시간대별 이벤트 추이</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id="evtFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: "hsl(var(--border))" }} />
              <Area type="monotone" dataKey="count" name="이벤트" stroke="hsl(var(--chart-1))" fill="url(#evtFill)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="glass-surface border-0">
        <CardHeader>
          <CardTitle className="text-base">이벤트 유형 분포</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          {dist.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              표시할 이벤트가 없습니다.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={dist}
                  dataKey="count"
                  nameKey="type"
                  cx="42%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={84}
                  paddingAngle={2}
                  stroke="hsl(var(--card))"
                  strokeWidth={2}
                >
                  {dist.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend
                  layout="vertical"
                  align="right"
                  verticalAlign="middle"
                  iconType="circle"
                  formatter={(value) => (
                    <span className="text-[12px] text-muted-foreground">{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
