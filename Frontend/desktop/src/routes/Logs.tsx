// Logs 페이지 — 에이전트 동작 로그(SystemLog) + 감사 로그(AuditLog) 2종(탭).
// P3.5 logsProvider(mock) 경유 — 직접 fetch 금지. 백엔드 /api/logs 신설 시 provider만 교체.
import { useEffect, useMemo, useState } from "react";
import { logsProvider } from "@/api/providers/logsProvider";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { SystemLog, AuditLog } from "@/types/contracts";

const LEVEL_CLS: Record<string, string> = {
  DEBUG: "bg-muted text-muted-foreground",
  INFO: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  WARN: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  ERROR: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
};
const ALL = "__all__";

function SystemLogTable({ logs }: { logs: SystemLog[] | null }) {
  const [level, setLevel] = useState(ALL);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!logs) return [];
    const query = q.toLowerCase();
    return logs.filter((l) => {
      if (level !== ALL && l.level !== level) return false;
      if (query && !`${l.agent} ${l.message}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [logs, level, q]);

  if (!logs) return <Skeleton className="mt-3 h-64 rounded-xl" />;

  return (
    <div className="mt-3">
      <div className="mb-3 flex flex-wrap gap-2">
        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger className="h-9 w-32">
            <SelectValue placeholder="전체 레벨" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 레벨</SelectItem>
            {["DEBUG", "INFO", "WARN", "ERROR"].map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="에이전트/메시지 검색"
          className="h-9 w-56"
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>시간</TableHead>
            <TableHead>에이전트</TableHead>
            <TableHead>레벨</TableHead>
            <TableHead>메시지</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                로그가 없습니다.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="tabular-nums text-muted-foreground">{l.time}</TableCell>
                <TableCell>{l.agent}</TableCell>
                <TableCell>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_CLS[l.level] ?? ""}`}>
                    {l.level}
                  </span>
                </TableCell>
                <TableCell>{l.message}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

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
  const [system, setSystem] = useState<SystemLog[] | null>(null);
  const [audit, setAudit] = useState<AuditLog[] | null>(null);

  useEffect(() => {
    let alive = true;
    void logsProvider.systemLogs().then((d) => alive && setSystem(d));
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
        <Tabs defaultValue="system">
          <TabsList>
            <TabsTrigger value="system">에이전트 동작</TabsTrigger>
            <TabsTrigger value="audit">감사 로그</TabsTrigger>
          </TabsList>
          <TabsContent value="system">
            <SystemLogTable logs={system} />
          </TabsContent>
          <TabsContent value="audit">
            <AuditLogTable logs={audit} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
