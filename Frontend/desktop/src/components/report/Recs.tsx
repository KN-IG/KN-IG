// 07 / ACTIONS — 우선순위 권고 카드. 원본 renderRecs 이식.
import type { ReportSummary } from "@/report/reportMockData";

const PR_COLOR: Record<string, string> = { crit: "--crit", high: "--high", med: "--med", low: "--low" };

export function Recs({ recs }: { recs: ReportSummary["recs"] }) {
  return (
    <div className="recs">
      {recs.map((r, i) => (
        <div key={i} className="rec">
          <div className="pr" style={{ background: `var(${PR_COLOR[r.sev] ?? "--blue"})` }}>{r.p}</div>
          <div>
            <h4>{r.title}</h4>
            <p>{r.body}</p>
            <div className="when">{r.when}</div>
            <div className="rlink">↳ {r.link}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
