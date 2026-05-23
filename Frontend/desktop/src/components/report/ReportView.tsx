// 보고서 전체 렌더 — 메타 헤더 + 10섹션(ReportBody) + PDF 인쇄.
import { Button } from "@/components/ui/button";
import { printReport } from "@/tauri/useWindow";
import { ReportBody } from "./ReportBody";
import type { Report } from "@/report/generateReport";
import type { FileEvent } from "@/types/contracts";
import "./reportPrint.css";

const SEVERITY_CLS: Record<string, string> = {
  Critical: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  High: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  Medium: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
};

export function ReportView({ report, event }: { report: Report; event: FileEvent }) {
  const sevCls = SEVERITY_CLS[report.severity] ?? SEVERITY_CLS.Medium;

  return (
    <div className="report-view">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">무결성 위반 분석 보고서</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{event.path}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>호스트: {event.agent}</span>
            <span>발생: {event.time}</span>
            <span>생성: {report.generatedAt}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${sevCls}`}>
            {report.severity}
          </span>
          <Button variant="outline" size="sm" onClick={() => void printReport()}>
            PDF 인쇄
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {report.sections.map((s, idx) => {
          const m = s.title.match(/^(\d+)\.\s*(.*)$/);
          const num = m ? m[1].padStart(2, "0") : "";
          const title = m ? m[2] : s.title;
          return (
            <section key={idx}>
              <header className="report-divider mb-3 flex items-center gap-3 border-b border-border pb-2">
                <span className="report-num inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-[11px] font-bold tabular-nums text-primary">
                  {num}
                </span>
                <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
              </header>
              <div className="pl-10 print:pl-0">
                <ReportBody text={s.body} />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
