// 주간 종합 무결성 리포트.
// CSS는 reportV2.css(.report-v2 스코프),
// 차트는 chart.js. topbar/progress는 콘솔 Navbar와 중복이라 생략(원본 embedded 모드와 동일).
//
// 섹션: HERO · RANGE · 01 KEY FINDINGS · 02 OVERVIEW(KPI) · 03 TREND · 04 SEVERITY&TARGETS
//       · 05 WHERE&HOW(ATT&CK) · 06 INCIDENTS · 07 ACTIONS · 08 REFERENCES
import { useEffect, useMemo, useState } from "react";
import "./reportV2.css";
import { MOCK_REPORT, type ReportSummary } from "@/report/reportMockData";
import { apiFetch } from "@/api/client";
import { config } from "@/config";
import { printReport } from "@/tauri/useWindow";
import { KeyFindings } from "./KeyFindings";
import { Kpis } from "./Kpis";
import { TimelineChart, SeverityChart, CategoryChart, HostChart } from "./ReportCharts";
import { AttackMatrix } from "./AttackMatrix";
import { Campaign } from "./Campaign";
import { Incidents } from "./Incidents";
import { Recs } from "./Recs";
import { Refs } from "./Refs";

function summarize(d: ReportSummary) {
  const sev = d.severity;
  const sevTotal = sev.Critical + sev.High + sev.Medium + sev.Low;
  const blocked = d.kpis.find((k) => /차단/.test(k.label) && !/미차단/.test(k.label))?.num ?? sevTotal;
  const unblocked = d.kpis.find((k) => /미차단/.test(k.label))?.num ?? 0;
  return {
    sevTotal,
    blocked,
    attempts: blocked + unblocked,
    hosts: d.hosts.length,
    crit: sev.Critical,
  };
}

export type RangeMode = "since" | "7d" | "custom";

// 기준 종료일(mock 데모) — 실데이터에선 무관.
const BASE_END = "2026-05-21";

function rangeDayCount(range: RangeMode, fromStr: string, toStr: string): number {
  if (range === "since") return 14;
  if (range === "7d") return 7;
  const f = new Date(fromStr);
  const t = new Date(toStr);
  if (isNaN(f.getTime()) || isNaN(t.getTime())) return 7;
  return Math.max(1, Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1);
}

function rangeToDates(range: RangeMode, fromStr: string, toStr: string): { from: string; to: string } {
  if (range === "custom" && fromStr && toStr) {
    return {
      from: new Date(fromStr + "T00:00:00").toISOString(),
      to: new Date(toStr + "T23:59:59").toISOString(),
    };
  }
  const days = range === "since" ? 14 : 7;
  const to = new Date();
  const from = new Date(Date.now() - days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// mock 모드 동적 파생 — 기간(일수)에 비례해 데이터를 스케일하고 차트 일자축을 재생성한다.
// (사건/매트릭스/권고 등 서술형은 base 유지.)
function deriveReport(base: ReportSummary, range: RangeMode, fromStr: string, toStr: string): ReportSummary {
  // since(저번 이후)·7d(최근 7일)는 v2 기본 데이터(160건)를 그대로 표시.
  // custom 기간을 고르면 선택 일수에 비례해 동적 파생한다.
  if (range !== "custom") return base;
  const dayCount = rangeDayCount(range, fromStr, toStr);
  const factor = dayCount / 7;
  const endDate = range === "custom" && toStr ? new Date(toStr) : new Date(BASE_END);

  const days: string[] = [];
  for (let i = dayCount - 1; i >= 0; i--) {
    const dt = new Date(endDate.getTime() - i * 86_400_000);
    days.push(`${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`);
  }
  const tile = (arr: number[]) => Array.from({ length: dayCount }, (_, i) => arr[i % arr.length]);
  const scale = (n: number) => Math.round(n * factor);

  const sevKeys = ["Critical", "High", "Medium", "Low"] as const;
  const blockedBySev = {} as ReportSummary["blockedBySev"];
  for (const k of sevKeys) blockedBySev[k] = tile(base.blockedBySev[k]);

  return {
    ...base,
    days,
    blockedBySev,
    prevPeriodDaily: tile(base.prevPeriodDaily),
    severity: {
      Critical: scale(base.severity.Critical),
      High: scale(base.severity.High),
      Medium: scale(base.severity.Medium),
      Low: scale(base.severity.Low),
    },
    category: base.category.map(([n, v, c]) => [n, scale(v), c] as [string, number, boolean]),
    hosts: base.hosts.map(([h, b, u]) => [h, scale(b), scale(u)] as [string, number, number]),
    kpis: base.kpis.map((k) => ({ ...k, num: scale(k.num), spark: k.spark.map(scale) })),
  };
}

// 실서버(LLM 프록시)에서 주간 요약을 받아온다. 원본 loadData 이식.
async function loadReportSummary(range: RangeMode, fromStr: string, toStr: string): Promise<ReportSummary | null> {
  const { from, to } = rangeToDates(range, fromStr, toStr);
  const url = `/api/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const res = await apiFetch(url, { method: "POST" });
  const d = (await res.json()) as Partial<ReportSummary>;
  return d && Array.isArray(d.days) ? (d as ReportSummary) : null;
}

export function ReportV2() {
  const [base, setBase] = useState<ReportSummary>(MOCK_REPORT);
  const [range, setRange] = useState<RangeMode>("since");
  const [from, setFrom] = useState("2026-05-14");
  const [to, setTo] = useState("2026-05-21");
  // 실서버 연동(useMock=false)에서 응답 실패 시 mock으로 폴백하되, 그 사실을 화면에 표시한다.
  // (조용한 폴백은 "연결 확인" 단계에서 가짜 성공으로 보여 디버깅을 흐린다.)
  const [liveError, setLiveError] = useState<string | null>(null);

  // mock: 기간 선택에 맞춰 데이터를 동적 파생. 실서버: 기간 변경 시 재요청.
  const d = useMemo(
    () => (config.useMock ? deriveReport(base, range, from, to) : base),
    [base, range, from, to],
  );

  useEffect(() => {
    if (config.useMock) return;
    let alive = true;
    loadReportSummary(range, from, to)
      .then((r) => {
        if (!alive) return;
        if (r) {
          setBase(r);
          setLiveError(null);
        } else {
          setLiveError("응답 형식 불일치(days 없음)"); // 200이나 ReportSummary 아님
        }
      })
      .catch((e) => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : "요청 실패";
        console.error("리포트 서버 응답 실패 — 임시 데이터로 표시:", e);
        setLiveError(msg); // 예: "503 Service Unavailable"(LLM 미가동)
      });
    return () => {
      alive = false;
    };
  }, [range, from, to]);

  const s = summarize(d);

  return (
    <div className="report-v2">
      <div className="wrap">
        {/* HERO */}
        <header className="hero in">
          <div className="kicker">주간 무결성 리포트 · 2026년 5월 3주차</div>
          <h1>
            이번 기간 <b><span className="num">{s.blocked}</span>건</b>의 변조 시도를 차단했습니다
          </h1>
          <p className="lede">
            KN-IG가 {s.hosts}개 핵심 자산에 대한 무결성 이벤트를 감시했으며, 대부분을 실제 피해가
            발생하기 전에 차단했습니다. 핵심 내용을 비전문가도 이해할 수 있도록 정리했습니다.
          </p>
          <div className="hero-meta">
            <span className="chip"><span className="lab">대상 기간</span>2026.05.14 – 05.21</span>
            <span className="chip"><span className="lab">감시 호스트</span>{s.hosts}대</span>
            <span className="chip sev"><span className="dot" style={{ background: "var(--crit)" }} />종합 위험도 HIGH</span>
            {!config.useMock && liveError && (
              <span className="chip sev" title={`리포트 서버 응답 실패: ${liveError} — LLM(:8088)/백엔드 확인`}>
                <span className="dot" style={{ background: "var(--high)" }} />임시 데이터 · {liveError}
              </span>
            )}
          </div>
        </header>

        {/* RANGE */}
        <div className="range-bar">
          <div className="seg">
            <button className={range === "since" ? "active" : ""} onClick={() => setRange("since")}>저번 리포트 이후</button>
            <button className={range === "7d" ? "active" : ""} onClick={() => setRange("7d")}>최근 7일</button>
            <button className={range === "custom" ? "active" : ""} onClick={() => setRange("custom")}>기간 선택</button>
          </div>
          {range === "custom" && (
            <div className="dates show">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span>→</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          )}
          <div className="range-hint">분석 대상 <b>{s.attempts}건</b></div>
          <button className="btn btn-primary" onClick={() => void printReport()} style={{ marginLeft: 8 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}>
              <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" />
            </svg>
            PDF 저장
          </button>
        </div>

        <KeyFindings findings={d.findings} />
        <Kpis data={d} />

        {/* 03 TREND */}
        <section>
          <div className="sec-head">
            <div className="eyebrow">03 / TREND</div>
            <h2>차단한 위협 추이</h2>
            <p>일자별 차단 위협을 위험 등급별로, 지난 기간과 비교해 보여줍니다.</p>
          </div>
          <div className="card">
            <h3>5월 18일, 차단 건수가 평소의 약 3배</h3>
            <div className="c-sub">위험 등급별 누적 · <b>점선=지난 기간 일별 합계</b></div>
            <div className="chart-box"><TimelineChart data={d} /></div>
            <div className="legend">
              <span><i style={{ background: "var(--crit)" }} />Critical</span>
              <span><i style={{ background: "var(--high)" }} />High</span>
              <span><i style={{ background: "var(--med)" }} />Medium</span>
              <span><i style={{ background: "var(--low)" }} />Low</span>
              <span><i className="dash" />지난 기간</span>
            </div>
          </div>
        </section>

        {/* 04 SEVERITY & TARGETS */}
        <section>
          <div className="sec-head">
            <div className="eyebrow">04 / SEVERITY &amp; TARGETS</div>
            <h2>위험도 및 표적 자산</h2>
            <p>위험 등급 분포와 표적이 된 자산 종류입니다.</p>
          </div>
          <div className="grid-2">
            <div className="card">
              <h3>치명적·높음이 전체의 43%</h3>
              <div className="c-sub">전체 이벤트 심각도별 분포</div>
              <div className="dough-wrap">
                <div className="chart-box"><SeverityChart data={d} /></div>
                <div className="dough-center"><div><div className="big num">{s.sevTotal}</div><div className="cap">전체</div></div></div>
              </div>
              <div className="legend">
                <span><i style={{ background: "var(--crit)" }} />Critical {d.severity.Critical}</span>
                <span><i style={{ background: "var(--high)" }} />High {d.severity.High}</span>
                <span><i style={{ background: "var(--med)" }} />Medium {d.severity.Medium}</span>
                <span><i style={{ background: "var(--low)" }} />Low {d.severity.Low}</span>
              </div>
            </div>
            <div className="card">
              <h3>상위 3종이 자격증명·권한·원격접속</h3>
              <div className="c-sub">표적 자산 종류별 건수 (치명적 자산 강조)</div>
              <div className="chart-box"><CategoryChart data={d} /></div>
            </div>
          </div>
        </section>

        {/* 05 WHERE & HOW (호스트 차트 — ATT&CK 매트릭스는 다음 단계) */}
        <section>
          <div className="sec-head">
            <div className="eyebrow">05 / WHERE &amp; HOW</div>
            <h2>발생 위치 및 공격 수법</h2>
            <p>호스트별 발생량과 국제 표준(MITRE ATT&amp;CK) 전술 단계별 관측 기법입니다.</p>
          </div>
          <div className="card" style={{ marginBottom: "16px" }}>
            <h3>HMI-01에 집중</h3>
            <div className="c-sub">호스트별 이벤트 · 차단 vs 미차단(확인 필요)</div>
            <div className="chart-box" style={{ height: "220px" }}><HostChart data={d} /></div>
          </div>
          <div className="card">
            <h3>공격 수법 한눈에 — ATT&amp;CK 매트릭스</h3>
            <div className="c-sub">공격자가 쓴 수법을 <b>전술(목적) 6단계</b>로 분류했습니다. 각 칸은 관측된 세부 기법이며 <b>색이 진할수록 자주</b> 관측됐습니다.</div>
            <AttackMatrix matrix={d.attackMatrix} />
            <div className="mx-legend"><span>적게 관측</span><span className="bar" /><span>자주 관측</span></div>
          </div>
        </section>

        {/* 06 INCIDENTS */}
        <section>
          <div className="sec-head">
            <div className="eyebrow">06 / INCIDENTS</div>
            <h2>주목할 사건</h2>
            <p>가장 위험했던 개별 사건과, 동일 시각 다중 호스트에서 발생한 캠페인 상관관계입니다. 항목을 펼치면 킬체인·프로세스 계보(PID Chain)가 표시됩니다.</p>
          </div>
          <Campaign data={d} />
          <Incidents data={d} />
          <p className="note">※ PID Chain 추적 항목: 프로세스명·PID/부모PID·실행파일·명령행·실행 사용자(uid→euid 권한 상승)·tty·세션. 원격 출처 IP는 현재 수집 항목에 포함되지 않으며, 원격 세션 여부는 tty(pts/*)로 간접 확인합니다.</p>
        </section>

        {/* 07 ACTIONS */}
        <section>
          <div className="sec-head">
            <div className="eyebrow">07 / ACTIONS</div>
            <h2>권고 조치</h2>
            <p>우선순위 순으로 정리한 즉시 실행 가능한 대응이며, 관련 사건과 연결됩니다.</p>
          </div>
          <Recs recs={d.recs} />
        </section>

        {/* 08 REFERENCES */}
        <section>
          <div className="sec-head">
            <div className="eyebrow">08 / REFERENCES</div>
            <h2>참조 기준 · 용어 · 방법론</h2>
          </div>
          <Refs mitreGlossary={d.mitreGlossary} />
        </section>

        <footer>
          <div>
            KN-IG 무결성 가드 · 자동 생성 리포트<br />
            본 리포트는 AI 분석 결과를 포함하며 참고용입니다. 최종 판단은 보안 담당자가 수행해야 합니다.
          </div>
          <div>KN-IG Console · mock data</div>
        </footer>
      </div>
    </div>
  );
}
