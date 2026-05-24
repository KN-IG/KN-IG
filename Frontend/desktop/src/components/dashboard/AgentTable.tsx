// 에이전트 목록 — 행 클릭 시 드릴다운 다이얼로그.
// OS·커널 버전·에이전트 버전 노출, 상태는 점+글씨(Navbar 톤), 우측 액션 메뉴(미구현).
import { MoreHorizontal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusDot } from "./StatusBadge";
import type { Agent } from "@/types/contracts";

const COLSPAN = 8;

// Guardian 표기 — 백엔드 MonitorType의 lkm/ebpf는 라벨로, 세분 값(LKM310 등)은 그대로.
const GUARDIAN_LABEL: Record<string, string> = {
  lkm: "LKM",
  ebpf: "eBPF LSM",
};

function guardianLabel(g?: string): string {
  if (!g) return "—";
  return GUARDIAN_LABEL[g.toLowerCase()] ?? g;
}

export function AgentTable({
  agents,
  onSelect,
}: {
  agents: Agent[];
  onSelect: (a: Agent) => void;
}) {
  return (
    <Card className="glass-surface border-0">
      <CardHeader>
        <CardTitle className="text-base">에이전트</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>호스트</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>운영체제</TableHead>
              <TableHead>커널 버전</TableHead>
              <TableHead>Guardian</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="w-12 text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLSPAN} className="py-8 text-center text-muted-foreground">
                  연결된 에이전트가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              agents.map((a) => (
                <TableRow
                  key={a.id}
                  className="cursor-pointer"
                  onClick={() => onSelect(a)}
                >
                  <TableCell className="font-medium">{a.id}</TableCell>
                  <TableCell>{a.hostname}</TableCell>
                  <TableCell className="text-muted-foreground">{a.ip || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{a.os || "—"}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{a.kernel || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{guardianLabel(a.guardian)}</TableCell>
                  <TableCell>
                    <StatusDot status={a.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <AgentActions agent={a} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// 에이전트 행 우측 액션 메뉴 — 비활성화/삭제(기능 미구현).
// 행 클릭(드릴다운)과 분리되도록 클릭 이벤트 전파를 차단한다.
function AgentActions({ agent }: { agent: Agent }) {
  void agent; // 후속: 비활성화/삭제 API 연동 시 사용
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            aria-label="에이전트 작업"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem disabled>비활성화</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled className="text-destructive focus:text-destructive">
            삭제
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
