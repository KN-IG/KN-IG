// Logs 페이지 — 실시간 에이전트 로그 tail + 감사 로그.
//
// 실시간 탭: 에이전트를 골라 운영 로그를 tail -f 처럼 따라간다(자동 스크롤/일시정지/레벨·검색 필터).
// logsProvider(mock) 경유 — 직접 fetch 금지. 백엔드 로그 스트림 신설 시 provider 한 줄만 교체.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Eraser,
  Pause,
  Play,
  Radio,
} from "lucide-react";
import { logsProvider } from "@/api/providers/logsProvider";
import { agentsProvider } from "@/api/providers/coreProviders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Agent, AgentLogLine, AuditLog, LogLevel } from "@/types/contracts";

const ALL = "__all__";
const LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR"];
const MAX_LINES = 500; // 버퍼 상한(메모리/렌더 보호)

// 터미널(다크 콘솔) 레벨 색 — 라이트/다크 공통으로 어두운 패널 위에 표시.
const LEVEL_TEXT: Record<LogLevel, string> = {
  DEBUG: "text-zinc-500",
  INFO: "text-sky-400",
  WARN: "text-amber-400",
  ERROR: "text-rose-400",
};

// ── 실시간 tail ──────────────────────────────────────────────────────

function LiveTail({ agents }: { agents: Agent[] }) {
  const [agentId, setAgentId] = useState(
    () => agents.find((a) => a.status === "ONLINE")?.id ?? agents[0]?.id ?? "",
  );
  const [level, setLevel] = useState(ALL);
  const [q, setQ] = useState("");
  const [follow, setFollow] = useState(true);
  const [paused, setPaused] = useState(false);
  const [lines, setLines] = useState<AgentLogLine[]>([]);

  const selected = agents.find((a) => a.id === agentId);
  const isOnline = selected?.status === "ONLINE";

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // 구독: 에이전트/온라인 여부가 바뀌면 재구독. 일시정지는 ref로 처리(재구독 없음).
  useEffect(() => {
    if (!agentId) return;
    setLines([]);
    const stop = logsProvider.streamAgentLogs(
      agentId,
      {
        onBackfill: (b) => setLines(b.slice(-MAX_LINES)),
        onLine: (l) => {
          if (pausedRef.current) return;
          setLines((prev) => {
            const next = [...prev, l];
            return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
          });
        },
      },
      { live: isOnline },
    );
    return stop;
  }, [agentId, isOnline]);

  const filtered = useMemo(() => {
    const query = q.toLowerCase();
    return lines.filter((l) => {
      if (level !== ALL && l.level !== level) return false;
      if (query && !`${l.source} ${l.message}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [lines, level, q]);

  // 자동 스크롤(follow & !paused) — 새 라인이 붙을 때마다 바닥으로.
  const viewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow && !paused && viewRef.current) {
      viewRef.current.scrollTop = viewRef.current.scrollHeight;
    }
  }, [filtered, follow, paused]);

  return (
    <div className="mt-3 flex flex-col gap-3">
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={agentId} onValueChange={setAgentId}>
          <SelectTrigger className="h-9 w-52">
            <SelectValue placeholder="에이전트 선택" />
          </SelectTrigger>
          <SelectContent>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      a.status === "ONLINE" ? "bg-emerald-500" : "bg-zinc-400",
                    )}
                  />
                  {a.hostname}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger className="h-9 w-28">
            <SelectValue placeholder="전체 레벨" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 레벨</SelectItem>
            {LEVELS.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="로그 검색(grep)"
          className="h-9 w-52"
        />

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={follow ? "default" : "outline"}
            size="sm"
            onClick={() => setFollow((v) => !v)}
            title="새 로그를 자동으로 따라갑니다"
          >
            <ArrowDownToLine />
            자동 스크롤
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaused((v) => !v)}
            disabled={!isOnline}
            title={isOnline ? "" : "오프라인 에이전트는 일시정지할 수 없습니다"}
          >
            {paused ? <Play /> : <Pause />}
            {paused ? "재개" : "일시정지"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLines([])}>
            <Eraser />
            지우기
          </Button>
        </div>
      </div>

      {/* 상태줄 */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {isOnline ? (
          <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <Radio className="size-3.5" />
            {paused ? "일시정지됨" : "실시간 수신 중"}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
            오프라인 — 최근 로그만 표시합니다
          </span>
        )}
        <span className="text-border">·</span>
        <span className="tabular-nums">
          {filtered.length}
          {filtered.length !== lines.length ? ` / ${lines.length}` : ""}줄
        </span>
      </div>

      {/* 터미널 뷰포트 */}
      <div
        ref={viewRef}
        className="h-[58vh] overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed shadow-inner"
      >
        {filtered.length === 0 ? (
          <div className="grid h-full place-items-center text-zinc-600">
            표시할 로그가 없습니다.
          </div>
        ) : (
          filtered.map((l) => (
            <div key={l.id} className="flex gap-2 whitespace-pre-wrap break-all">
              <span className="shrink-0 text-zinc-600">{l.ts}</span>
              <span className={cn("w-12 shrink-0 font-semibold", LEVEL_TEXT[l.level])}>
                {l.level}
              </span>
              <span className="shrink-0 text-zinc-500">[{l.source}]</span>
              <span className="text-zinc-200">{l.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── 감사 로그 ────────────────────────────────────────────────────────

function AuditLogTable({ logs }: { logs: AuditLog[] | null }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!logs) return [];
    const query = q.toLowerCase();
    return logs.filter(
      (l) =>
        !query ||
        `${l.actor} ${l.action} ${l.target} ${l.detail ?? ""}`.toLowerCase().includes(query),
    );
  }, [logs, q]);

  if (!logs) return <Skeleton className="mt-3 h-64 rounded-xl" />;

  return (
    <div className="mt-3">
      <div className="mb-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="행위자/동작/대상 검색"
          className="h-9 w-56"
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>시간</TableHead>
            <TableHead>행위자</TableHead>
            <TableHead>동작</TableHead>
            <TableHead>대상</TableHead>
            <TableHead>상세</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                감사 로그가 없습니다.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="tabular-nums text-muted-foreground">{l.time}</TableCell>
                <TableCell>{l.actor}</TableCell>
                <TableCell>{l.action}</TableCell>
                <TableCell>{l.target}</TableCell>
                <TableCell className="text-muted-foreground">{l.detail ?? "—"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export default function Logs() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [audit, setAudit] = useState<AuditLog[] | null>(null);

  useEffect(() => {
    let alive = true;
    void agentsProvider.list().then((d) => alive && setAgents(d));
    void logsProvider.auditLogs().then((d) => alive && setAudit(d));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card className="glass-surface border-0">
      <CardHeader>
        <CardTitle className="text-base">로그</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="live">
          <TabsList>
            <TabsTrigger value="live">실시간 로그</TabsTrigger>
            <TabsTrigger value="audit">감사 로그</TabsTrigger>
          </TabsList>
          <TabsContent value="live">
            {!agents ? (
              <Skeleton className="mt-3 h-[58vh] rounded-xl" />
            ) : agents.length === 0 ? (
              <div className="mt-3 py-12 text-center text-muted-foreground">
                연결된 에이전트가 없습니다.
              </div>
            ) : (
              <LiveTail agents={agents} />
            )}
          </TabsContent>
          <TabsContent value="audit">
            <AuditLogTable logs={audit} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
