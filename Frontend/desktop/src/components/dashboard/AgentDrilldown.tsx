// 에이전트 드릴다운 — 선택 호스트의 상태 + 최근 이벤트.
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "./StatusBadge";
import type { Agent, FileEvent } from "@/types/contracts";

export function AgentDrilldown({
  agent,
  events,
  onOpenChange,
}: {
  agent: Agent | null;
  events: FileEvent[];
  onOpenChange: (open: boolean) => void;
}) {
  const recent = agent
    ? events.filter((e) => e.agentId === agent.id).slice(0, 10)
    : [];

  return (
    <Dialog open={!!agent} onOpenChange={onOpenChange}>
      <DialogContent className="glass-surface max-w-lg border-0">
        {agent && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {agent.hostname}
                <StatusBadge status={agent.status} />
              </DialogTitle>
              <DialogDescription>
                {agent.id} · {agent.ip || "IP 미상"}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2">
              <div className="mb-2 text-[13px] font-semibold text-muted-foreground">
                최근 이벤트
              </div>
              {recent.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  최근 이벤트가 없습니다.
                </p>
              ) : (
                <ul className="max-h-64 space-y-1.5 overflow-auto">
                  {recent.map((e) => (
                    <li key={e.id} className="flex justify-between gap-3 text-[13px]">
                      <span className="truncate">{e.path}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {e.time.slice(11)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
