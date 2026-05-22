// Policy 페이지 — 에이전트별 정책 배포 관리(Agent↔Policy 매핑/배포 현황) + 정책 목록.
// P3.5 policyProvider(mock) 경유 — 직접 fetch 금지. 백엔드 /api/policy 신설 시 provider만 교체.
import { useEffect, useState } from "react";
import { policyProvider } from "@/api/providers/policyProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { Policy as PolicyType, PolicyDeployment } from "@/types/contracts";

const STATUS: Record<string, { label: string; cls: string }> = {
  APPLIED: { label: "적용됨", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  PENDING: { label: "대기", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  FAILED: { label: "실패", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400" },
};

export default function Policy() {
  const [policies, setPolicies] = useState<PolicyType[] | null>(null);
  const [deployments, setDeployments] = useState<PolicyDeployment[] | null>(null);

  useEffect(() => {
    let alive = true;
    void policyProvider.policies().then((d) => alive && setPolicies(d));
    void policyProvider.deployments().then((d) => alive && setDeployments(d));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <Card className="glass-surface border-0">
        <CardHeader>
          <CardTitle className="text-base">에이전트별 정책 배포 현황</CardTitle>
        </CardHeader>
        <CardContent>
          {!deployments ? (
            <Skeleton className="h-48 rounded-xl" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>에이전트</TableHead>
                  <TableHead>정책</TableHead>
                  <TableHead>적용 시각</TableHead>
                  <TableHead>상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deployments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      배포 내역이 없습니다.
                    </TableCell>
                  </TableRow>
                ) : (
                  deployments.map((d) => {
                    const s = STATUS[d.status] ?? STATUS.PENDING;
                    return (
                      <TableRow key={`${d.agentId}-${d.policyId}`}>
                        <TableCell className="font-medium">{d.agent}</TableCell>
                        <TableCell>{d.policy}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">{d.appliedAt}</TableCell>
                        <TableCell>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
                            {s.label}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="glass-surface border-0">
        <CardHeader>
          <CardTitle className="text-base">정책 목록</CardTitle>
        </CardHeader>
        <CardContent>
          {!policies ? (
            <Skeleton className="h-48 rounded-xl" />
          ) : (
            <div className="flex flex-col gap-4">
              {policies.map((p) => (
                <div key={p.id} className="rounded-lg border border-border/60 p-4">
                  <div className="text-sm font-semibold text-foreground">{p.name}</div>
                  <div className="mt-2 flex flex-col gap-2 text-[13px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-muted-foreground">감시 경로:</span>
                      {p.scope.map((s) => (
                        <span
                          key={s}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground/80"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-muted-foreground">규칙:</span>
                      {p.rules.map((r) => (
                        <span
                          key={r}
                          className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
