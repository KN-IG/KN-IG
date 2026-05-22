// Report 페이지 — 무결성 이벤트 목록에서 보고서 생성/열람(신규 React, iframe 폐기).
// 보고서는 클라이언트 mock(generateReport) + 캐시(REPORT_STORE). 후속: POST /api/reports/generate.
import { useCallback, useState } from "react";
import { usePolling } from "@/api/hooks/usePolling";
import { useConnection } from "@/state/ConnectionContext";
import { eventsProvider } from "@/api/providers/coreProviders";
import {
  generateReport,
  getReport,
  hasReport,
  type Report as ReportData,
} from "@/report/generateReport";
import { ReportView } from "@/components/report/ReportView";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { FileEvent } from "@/types/contracts";

export default function Report() {
  const { setConnected } = useConnection();
  const fetcher = useCallback(() => eventsProvider.list(200), []);
  const { data: events, loading } = usePolling<FileEvent[]>(fetcher, 5000, setConnected);

  const [active, setActive] = useState<{ event: FileEvent; report: ReportData } | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [, forceTick] = useState(0); // hasReport 갱신 트리거

  const handle = async (event: FileEvent) => {
    if (hasReport(event.id)) {
      const r = getReport(event.id);
      if (r) setActive({ event, report: r });
      return;
    }
    setGenerating(event.id);
    try {
      const report = await generateReport(event);
      setActive({ event, report });
      forceTick((n) => n + 1);
    } finally {
      setGenerating(null);
    }
  };

  if (loading && !events) {
    return <Skeleton className="h-96 rounded-2xl" />;
  }

  const list = events ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card className="glass-surface border-0">
        <CardHeader>
          <CardTitle className="text-base">무결성 이벤트 보고서</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>시간</TableHead>
                <TableHead>에이전트</TableHead>
                <TableHead>경로</TableHead>
                <TableHead className="text-right">보고서</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    이벤트가 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                list.slice(0, 50).map((e) => {
                  const has = hasReport(e.id);
                  const busy = generating === e.id;
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="tabular-nums text-muted-foreground">{e.time}</TableCell>
                      <TableCell>{e.agent}</TableCell>
                      <TableCell className="max-w-xs truncate">{e.path}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant={has ? "secondary" : "outline"}
                          size="sm"
                          disabled={busy}
                          onClick={() => handle(e)}
                        >
                          {busy ? "생성 중…" : has ? "보고서 열람" : "보고서 생성"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="glass-surface max-h-[85vh] max-w-3xl overflow-auto border-0">
          <DialogTitle className="sr-only">무결성 위반 분석 보고서</DialogTitle>
          {active && <ReportView report={active.report} event={active.event} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
