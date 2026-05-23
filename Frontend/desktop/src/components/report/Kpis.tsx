// 02 / OVERVIEW — KPI 4종(아이콘+delta+스파크라인) + 요약 문단.
import { StrokeIcon, ICON_PATHS } from "./reportIcons";
import { Spark } from "./Spark";
import type { ReportSummary } from "@/report/reportMockData";

const WASH_K: Record<string, string> = {
  "--blue": "--blue-wash",
  "--low": "--low-wash",
  "--high": "--high-wash",
  "--crit": "--crit-wash",
};

export function Kpis({ data }: { data: ReportSummary }) {
  const sev = data.severity;
  const sevTotal = sev.Critical + sev.High + sev.Medium + sev.Low;
  const blocked = data.kpis.find((k) => /차단/.test(k.label) && !/미차단/.test(k.label))?.num ?? sevTotal;
  const unblocked = data.kpis.find((k) => /미차단/.test(k.label))?.num ?? 0;
  const attempts = blocked + unblocked;
  const rate = Math.round((attempts ? (blocked / attempts) * 100 : 100) * 10) / 10;
  const totalK = data.kpis.find((k) => /전체 이벤트/.test(k.label));
  const totalDelta =
    totalK && totalK.delta && !["—", "± 0%", "신규"].includes(totalK.delta)
      ? ` 전체 이벤트는 전기간 대비 ${totalK.delta} 수준입니다.`
      : "";

  return (
    <section>
      <div className="sec-head">
        <div className="eyebrow">02 / OVERVIEW</div>
        <h2>한눈에 보기</h2>
        <p>핵심 지표와 전기간 대비 변화입니다.</p>
      </div>
      <div className="kpis">
        {data.kpis.map((k, i) => (
          <div key={i} className="kpi">
            <div className="k-top">
              <span className="k-ic" style={{ background: `var(${WASH_K[k.color] ?? "--blue-wash"})`, color: `var(${k.color})` }}>
                <StrokeIcon>{ICON_PATHS[k.icon] ?? ICON_PATHS.folder}</StrokeIcon>
              </span>
              <span className={`k-delta ${k.tone}`}>{k.delta}</span>
            </div>
            <div className="k-label">{k.label}</div>
            <div className="k-num num">{k.num.toLocaleString()}</div>
            <div className="k-foot">
              <span className="k-sub">{k.sub}</span>
              <Spark series={k.spark} colorVar={k.color} />
            </div>
          </div>
        ))}
      </div>
      <div className="plain">
        <span className="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5" strokeLinecap="round" />
            <path d="M12 8h.01" strokeLinecap="round" />
          </svg>
        </span>
        <div>
          <b>요약</b> 변경 시도 {attempts.toLocaleString()}건 중 {blocked.toLocaleString()}건({rate}%)을 사전 차단했습니다.
          {totalDelta}{" "}
          {sev.Critical > 0
            ? `치명적 자산 표적 ${sev.Critical}건이 확인되어 추가 조사가 필요합니다.`
            : "치명적 자산 표적은 확인되지 않았습니다."}
        </div>
      </div>
    </section>
  );
}
