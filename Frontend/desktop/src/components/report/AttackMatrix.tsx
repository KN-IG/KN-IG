// 05 / WHERE & HOW — ATT&CK 매트릭스 히트맵. 원본 renderMatrix 이식.
// 셀 농도는 color-mix(var(--blue))로 표현 → 테마(.report-v2 스코프 토큰) 자동 대응.
import type { ReportSummary } from "@/report/reportMockData";

export function AttackMatrix({ matrix }: { matrix: ReportSummary["attackMatrix"] }) {
  const maxN = Math.max(1, ...matrix.flatMap((c) => c.tech.map((t) => t.n)));

  if (matrix.length === 0) {
    return <div className="empty">관측된 MITRE ATT&amp;CK 기법이 없습니다.</div>;
  }

  return (
    <div className="matrix">
      {matrix.map((col, ci) => (
        <div key={ci} className="mx-col">
          <div className="mx-head">
            {col.tactic}
            <span className="ph">{col.en}</span>
          </div>
          {col.tech.map((t, ti) => {
            const a = 0.12 + 0.6 * (t.n / maxN);
            return (
              <div
                key={ti}
                className="mx-cell"
                style={{ background: `color-mix(in srgb, var(--blue) ${(a * 100).toFixed(1)}%, transparent)` }}
              >
                <div className="code" style={{ color: "var(--blue-dark)" }}>{t.id}</div>
                <div className="nm">{t.nm}</div>
                <div className="ct">{t.n}건</div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
