// 06 / INCIDENTS — 캠페인 상관 타임라인. 원본 renderCampaign 이식.
import type { ReportSummary } from "@/report/reportMockData";

function sevVar(s: string): string {
  return s === "Critical" ? "--crit" : s === "High" ? "--high" : s === "Medium" ? "--med" : "--low";
}

export function Campaign({ data }: { data: ReportSummary }) {
  const events = [...data.campaign].sort((a, b) => a.t - b.t);

  return (
    <div className="campaign">
      <h3>여러 호스트에서 동시에? — 캠페인 상관</h3>
      <div className="c-sub">
        가로축은 <b>시간</b>, 각 줄은 <b>호스트(컴퓨터)</b>입니다. 점 하나가 차단된 시도이고 색은
        위험도예요. <b>짧은 시간에 여러 호스트로 점이 몰리면</b> 한 공격자의 조직적 시도일 가능성이
        높습니다.
      </div>
      <div>
        {data.campaignHosts.map((host) => (
          <div key={host} className="camp-lane">
            <span className="lane-label">{host}</span>
            <span className="camp-track">
              {data.campaign
                .filter((c) => c.host === host)
                .map((c, i) => (
                  <span
                    key={i}
                    className="camp-dot"
                    title={c.label}
                    style={{ left: `${((c.t / 15) * 100).toFixed(1)}%`, background: `var(${sevVar(c.sev)})` }}
                  />
                ))}
            </span>
          </div>
        ))}
      </div>
      <div className="camp-axis">
        <span>15:00</span>
        <span>15:05</span>
        <span>15:10</span>
        <span>15:15</span>
      </div>
      <div className="camp-legend">
        <span><i style={{ background: "var(--crit)" }} />Critical</span>
        <span><i style={{ background: "var(--low)" }} />Low</span>
        <span className="camp-hint">↳ 15:01–15:06, 3개 호스트가 6분 내 연쇄 — 조직적 캠페인으로 추정</span>
      </div>
      <ol className="camp-events">
        {events.map((c, i) => {
          const tt = "15:" + String(c.t).padStart(2, "0");
          const file = c.label.replace(/\s\d{2}:\d{2}$/, "");
          return (
            <li key={i}>
              <span className="ev-dot" style={{ background: `var(${sevVar(c.sev)})` }} />
              <span className="ev-t">{tt}</span>
              <span className="ev-host">{c.host}</span>
              <span>{file} · {c.sev}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
