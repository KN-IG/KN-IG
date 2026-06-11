// 06 / INCIDENTS — 사건 아코디언 + 킬체인 ribbon + PID Chain. 원본 renderIncidents 이식.
import { Fragment, useState } from "react";
import type { ReportSummary, Incident, ChainNode } from "@/report/reportMockData";

function KillRibbon({ active, phases }: { active: number[]; phases: string[] }) {
  return (
    <>
      <div className="kill">
        <span className="kl-label">공격 단계</span>
        {phases.map((p, i) => (
          <Fragment key={i}>
            <span className={`kstep ${active.includes(i) ? "on" : ""}`}>{p}</span>
            {i < phases.length - 1 && <span className="karrow">→</span>}
          </Fragment>
        ))}
      </div>
      <div className="kill-cap">
        왼쪽 → 오른쪽이 공격 진행 순서입니다. <b>파란 단계</b>가 이 사건에서 실제로 시도된 단계예요.
      </div>
    </>
  );
}

function ChainNodeView({ n }: { n: ChainNode }) {
  return (
    <div className={`cnode ${n.esc ? "esc" : ""} ${n.blocked ? "blocked" : ""}`}>
      <div className="cdot">{n.blocked ? "✕" : n.step}</div>
      <div className="cbody">
        <div className="ctop">
          <span className="cname">{n.name}</span>
          <span className="cpid">PID {n.pid} · PPID {n.ppid}</span>
        </div>
        <div className="cexe">{n.cmd || n.exe}</div>
        <div className="cmeta">
          <span className={`ctag ${n.esc ? "esc" : ""}`}>user {n.user}</span>
          {n.tty && <span className="ctag">tty {n.tty}</span>}
          {n.tech && <span className="ctag tech">{n.tech}</span>}
          {n.esc && <span className="ctag esc">권한 상승</span>}
          {n.blocked && <span className="ctag blk">차단됨</span>}
        </div>
        <div className="cnote">{n.note}</div>
      </div>
    </div>
  );
}

function IncidentItem({ x, idx, phases }: { x: Incident; idx: number; phases: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`inc ${open ? "open" : ""}`}>
      <div className="inc-head" onClick={() => setOpen((o) => !o)}>
        <span className={`pill sev-${x.sev}`}>{x.sev}</span>
        <div className="inc-main">
          <div className="inc-path">#{idx + 1} {x.path}</div>
          <div className="inc-desc">{x.desc}</div>
        </div>
        <div className="inc-meta">{x.host}<br />{x.time}</div>
        <span className="inc-chev">›</span>
      </div>
      <div className="inc-body">
        <div className="inc-body-inner">
          <div className="row"><span className="lbl">시도 유형</span><span>{x.type} · {x.action}</span></div>
          <div className="row">
            <span className="lbl">공격 수법</span>
            <span>{x.mitre.map((m, i) => <span key={i} className="tag">{m}</span>)}</span>
          </div>
          <div className="row"><span className="lbl">분석</span><span>{x.detail}</span></div>
          <KillRibbon active={x.kill} phases={phases} />
          <div className="inc-chain-head">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="2.4" />
              <circle cx="6" cy="18" r="2.4" />
              <circle cx="18" cy="18" r="2.4" />
              <path d="M6 8.4v3.2a3 3 0 0 0 3 3h6.6M6 14.6v1" />
            </svg>
            공격 추적 (PID Chain)
          </div>
          <div className="chain">
            {x.chain.length > 0
              ? x.chain.map((n, i) => <ChainNodeView key={i} n={n} />)
              : <div className="empty">PID Chain 데이터가 수집되지 않았습니다.</div>}
          </div>
          <div className="inc-finding"><b>핵심 발견</b> {x.finding}</div>
        </div>
      </div>
    </div>
  );
}

export function Incidents({ data }: { data: ReportSummary }) {
  if (data.incidents.length === 0) {
    return <div className="empty">선택한 기간에 주목할 사건이 없습니다.</div>;
  }

  return (
    <div className="incidents">
      {data.incidents.map((x, i) => (
        <IncidentItem key={i} x={x} idx={i} phases={data.killPhases} />
      ))}
    </div>
  );
}
