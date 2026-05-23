// KPI 스파크라인 — 원본 sparkSVG 이식(SVG 직접 생성).
export function Spark({ series, colorVar }: { series: number[]; colorVar: string }) {
  const w = 72;
  const h = 24;
  const p = 2;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const rng = max - min || 1;
  const pts = series.map((v, i) => {
    const x = p + (i * (w - 2 * p)) / (series.length - 1);
    const y = h - p - ((v - min) / rng) * (h - 2 * p);
    return [x, y] as const;
  });
  const line = pts.map((q, i) => (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" ");
  const area = line + ` L${(w - p).toFixed(1)} ${h - p} L${p} ${h - p} Z`;
  const c = `var(${colorVar})`;
  const last = pts[pts.length - 1];

  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <path d={area} fill={c} fillOpacity={0.12} />
      <path d={line} stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r={2} fill={c} />
    </svg>
  );
}
