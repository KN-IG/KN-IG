// v2 차트 4종 — chart.js(react-chartjs-2). 원본 makeTimeline/Severity/Category/Host 이식.
// canvas는 CSS 변수를 못 읽으므로 v2 토큰값을 라이트/다크 상수로 두고 테마로 선택한다.
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  type Plugin,
  type ChartDataset,
} from "chart.js";
import { Line, Doughnut, Bar } from "react-chartjs-2";
import { useTheme } from "@/theme/ThemeProvider";
import type { ReportSummary } from "@/report/reportMockData";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Filler, Tooltip);

const LIGHT = {
  crit: "#ff3b30", high: "#ff9500", med: "#007aff", low: "#34c759",
  blue: "#0071e3", ink: "#1d1d1f", inkFaint: "#86868b", inkSoft: "#6e6e73",
  lineSoft: "#e8e8ed", surface: "#ffffff", bg: "#f5f5f7",
};
const DARK = {
  crit: "#ff453a", high: "#ff9f0a", med: "#0a84ff", low: "#30d158",
  blue: "#0a84ff", ink: "#f5f5f7", inkFaint: "#86868b", inkSoft: "#a1a1a6",
  lineSoft: "#2c2c2e", surface: "#1c1c1e", bg: "#000000",
};
type Colors = typeof LIGHT;

function useColors(): Colors {
  const { theme } = useTheme();
  return theme === "dark" ? DARK : LIGHT;
}

function hexA(hex: string, a: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function tooltip(c: Colors) {
  return {
    backgroundColor: c.ink,
    titleColor: c.bg,
    bodyColor: c.bg,
    padding: 10,
    cornerRadius: 10,
    displayColors: true,
    boxPadding: 5,
    usePointStyle: true,
  };
}

// 막대 값 직접 라벨 플러그인(원본 valueLabel) — 카테고리 차트용.
const valueLabel: Plugin<"bar"> = {
  id: "valueLabel",
  afterDatasetsDraw(chart) {
    const o = (chart.options.plugins as Record<string, unknown>)?.valueLabel as
      | { on?: boolean; color?: string }
      | undefined;
    if (!o?.on) return;
    const { ctx } = chart;
    chart.data.datasets.forEach((ds, di) => {
      chart.getDatasetMeta(di).data.forEach((el, i) => {
        ctx.save();
        ctx.font = `600 11px ${getComputedStyle(document.body).fontFamily}`;
        ctx.fillStyle = o.color ?? "#888";
        ctx.textBaseline = "middle";
        ctx.fillText(String(ds.data[i]), el.x + 7, el.y);
        ctx.restore();
      });
    });
  },
};
ChartJS.register(valueLabel);

export function TimelineChart({ data }: { data: ReportSummary }) {
  const c = useColors();
  const order = ["Low", "Medium", "High", "Critical"] as const;
  const sevColor: Record<string, string> = { Low: c.low, Medium: c.med, High: c.high, Critical: c.crit };
  const datasets: ChartDataset<"line">[] = order.map((k) => ({
    label: k,
    data: data.blockedBySev[k],
    borderColor: sevColor[k],
    backgroundColor: hexA(sevColor[k], 0.5),
    fill: true,
    tension: 0.35,
    borderWidth: 1.5,
    pointRadius: 0,
    pointHoverRadius: 4,
    stack: "sev",
  }));
  datasets.push({
    label: "지난 기간",
    data: data.prevPeriodDaily,
    borderColor: c.inkFaint,
    borderDash: [5, 4],
    backgroundColor: "transparent",
    fill: false,
    tension: 0.35,
    borderWidth: 1.5,
    pointRadius: 0,
    pointHoverRadius: 4,
    stack: "cmp",
  });

  return (
    <Line
      data={{ labels: data.days, datasets }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: tooltip(c) },
        scales: {
          x: { grid: { display: false }, stacked: true, ticks: { color: c.inkFaint } },
          y: { beginAtZero: true, stacked: true, ticks: { color: c.inkFaint }, grid: { color: c.lineSoft } },
        },
      }}
    />
  );
}

export function SeverityChart({ data }: { data: ReportSummary }) {
  const c = useColors();
  const s = data.severity;
  return (
    <Doughnut
      data={{
        labels: ["Critical", "High", "Medium", "Low"],
        datasets: [{
          data: [s.Critical, s.High, s.Medium, s.Low],
          backgroundColor: [c.crit, c.high, c.med, c.low],
          borderColor: c.surface,
          borderWidth: 4,
          hoverOffset: 6,
          borderRadius: 6,
        }],
      }}
      options={{
        cutout: "72%",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: tooltip(c) },
      }}
    />
  );
}

export function CategoryChart({ data }: { data: ReportSummary }) {
  const c = useColors();
  return (
    <Bar
      data={{
        labels: data.category.map((x) => x[0]),
        datasets: [{
          data: data.category.map((x) => x[1]),
          backgroundColor: data.category.map((x) => (x[2] ? c.crit : c.blue)),
          borderRadius: 7,
          barThickness: 14,
        }],
      }}
      options={{
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 28 } },
        plugins: {
          legend: { display: false },
          tooltip: tooltip(c),
          // 커스텀 valueLabel 플러그인 옵션
          valueLabel: { on: true, color: c.inkSoft },
        } as never,
        scales: {
          x: { beginAtZero: true, grid: { display: false }, ticks: { display: false } },
          y: { grid: { display: false }, ticks: { color: c.inkFaint } },
        },
      }}
    />
  );
}

export function HostChart({ data }: { data: ReportSummary }) {
  const c = useColors();
  return (
    <Bar
      data={{
        labels: data.hosts.map((h) => h[0]),
        datasets: [
          { label: "차단", data: data.hosts.map((h) => h[1]), backgroundColor: c.blue, barThickness: 30, stack: "s", borderRadius: { bottomLeft: 7, bottomRight: 7 } as never },
          { label: "미차단", data: data.hosts.map((h) => h[2]), backgroundColor: c.crit, barThickness: 30, stack: "s", borderRadius: { topLeft: 7, topRight: 7 } as never },
        ],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: tooltip(c) },
        scales: {
          x: { grid: { display: false }, stacked: true, ticks: { color: c.inkFaint } },
          y: { beginAtZero: true, stacked: true, ticks: { color: c.inkFaint }, grid: { color: c.lineSoft } },
        },
      }}
    />
  );
}
