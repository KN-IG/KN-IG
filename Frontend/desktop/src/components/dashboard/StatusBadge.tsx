// 에이전트 상태 배지 — 의미색(녹/적/회). 원본 ui.js STATUS_CLASSES 톤 계승.
import type { AgentStatus } from "@/types/contracts";

const MAP: Record<string, { label: string; cls: string }> = {
  ONLINE: { label: "온라인", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  OFFLINE: { label: "오프라인", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400" },
  UNKNOWN: { label: "알 수 없음", cls: "bg-muted text-muted-foreground" },
};

export function StatusBadge({ status }: { status: AgentStatus | string }) {
  const m = MAP[status] ?? MAP.UNKNOWN;
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}
