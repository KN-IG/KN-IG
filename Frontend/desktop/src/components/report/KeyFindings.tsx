// 01 / KEY FINDINGS — 핵심 발견 3종 카드.
import { StrokeIcon, ICON_PATHS } from "./reportIcons";
import type { ReportFinding } from "@/report/reportMockData";

const WASH: Record<string, string> = { crit: "--crit-wash", high: "--high-wash", low: "--low-wash" };
const COL: Record<string, string> = { crit: "--crit", high: "--high", low: "--low" };
const FIND_ICON: Record<string, string> = { crit: "alert", high: "search", low: "shield" };

export function KeyFindings({ findings }: { findings: ReportFinding[] }) {
  return (
    <section>
      <div className="sec-head">
        <div className="eyebrow">01 / KEY FINDINGS</div>
        <h2>핵심 발견</h2>
        <p>이번 기간에서 가장 먼저 알아야 할 세 가지입니다.</p>
      </div>
      <div className="findings">
        {findings.map((f, i) => (
          <div key={i} className={`finding ${f.sev}`}>
            <div className="f-top">
              <span className="f-ic" style={{ background: `var(${WASH[f.sev] ?? "--blue-wash"})`, color: `var(${COL[f.sev] ?? "--blue"})` }}>
                <StrokeIcon>{ICON_PATHS[FIND_ICON[f.sev] ?? "alert"]}</StrokeIcon>
              </span>
              <span className="fnum">0{i + 1}</span>
            </div>
            <div className="fstat" style={{ color: `var(${COL[f.sev] ?? "--blue"})` }}>{f.stat}</div>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
            <span className="ftag">{f.tag}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
