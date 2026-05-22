// 무결성 이벤트 테이블 — 에이전트/유형 필터 + 검색 + 페이지네이션.
// 원본 app.js getFilteredEvents/renderEvents 이식.
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Button } from "@/components/ui/button";
import type { Agent, FileEvent } from "@/types/contracts";

const PER_PAGE = 10;
const ALL = "__all__"; // Radix Select는 빈 문자열 value 불가.

export function EventTable({
  events,
  agents,
}: {
  events: FileEvent[];
  agents: Agent[];
}) {
  const [agentFilter, setAgentFilter] = useState(ALL);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const types = useMemo(
    () => Array.from(new Set(events.map((e) => String(e.type)))),
    [events],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return events.filter((e) => {
      if (agentFilter !== ALL && e.agent !== agentFilter) return false;
      if (typeFilter !== ALL && String(e.type) !== typeFilter) return false;
      if (q) {
        const hay = `${e.time} ${e.agent} ${e.event} ${e.path}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, agentFilter, typeFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const curPage = Math.min(page, totalPages);
  const paged = filtered.slice((curPage - 1) * PER_PAGE, curPage * PER_PAGE);

  const resetPage = () => setPage(1);

  return (
    <Card className="glass-surface border-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">무결성 이벤트</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={agentFilter}
            onValueChange={(v) => {
              setAgentFilter(v);
              resetPage();
            }}
          >
            <SelectTrigger className="h-9 w-36">
              <SelectValue placeholder="전체 에이전트" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>전체 에이전트</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.hostname}>
                  {a.hostname}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={typeFilter}
            onValueChange={(v) => {
              setTypeFilter(v);
              resetPage();
            }}
          >
            <SelectTrigger className="h-9 w-32">
              <SelectValue placeholder="전체 유형" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>전체 유형</SelectItem>
              {types.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
            placeholder="경로/에이전트 검색"
            className="h-9 w-48"
          />
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>시간</TableHead>
              <TableHead>에이전트</TableHead>
              <TableHead>이벤트</TableHead>
              <TableHead>조치</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  표시할 이벤트가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              paged.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular-nums text-muted-foreground">{e.time}</TableCell>
                  <TableCell>{e.agent}</TableCell>
                  <TableCell className="max-w-xs truncate">{e.event}</TableCell>
                  <TableCell>
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                      {e.action}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="mt-3 flex items-center justify-between text-[13px] text-muted-foreground">
          <span>
            {curPage} / {totalPages} 페이지 · 총 {filtered.length}건
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={curPage <= 1}
              onClick={() => setPage(curPage - 1)}
            >
              이전
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={curPage >= totalPages}
              onClick={() => setPage(curPage + 1)}
            >
              다음
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
