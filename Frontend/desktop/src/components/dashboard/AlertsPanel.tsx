// 알림 패널 — 미해결 알림을 심각도별로 노출 + 해결 처리(/api/alerts/:id/resolve).
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Alert } from "@/types/contracts";

const SEVERITY: Record<string, { label: string; cls: string }> = {
  HIGH: { label: "높음", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" },
  MEDIUM: { label: "보통", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  LOW: { label: "낮음", cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" },
};

export function AlertsPanel({
  alerts,
  onResolve,
}: {
  alerts: Alert[];
  onResolve: (id: string) => void;
}) {
  const open = alerts.filter((a) => !a.resolved);

  return (
    <Card className="glass-surface border-0">
      <CardHeader>
        <CardTitle className="text-base">
          알림
          {open.length > 0 && (
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              ({open.length}건 미해결)
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {open.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">미해결 알림이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {open.map((a) => {
              const s = SEVERITY[a.severity] ?? SEVERITY.LOW;
              return (
                <li
                  key={a.id}
                  className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2"
                >
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                    {s.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{a.message}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.agent} · {a.time}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => onResolve(a.id)}>
                    해결
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
