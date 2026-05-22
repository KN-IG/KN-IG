// 에이전트 목록 — 행 클릭 시 드릴다운 다이얼로그.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "./StatusBadge";
import type { Agent } from "@/types/contracts";

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
              <TableHead>상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
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
                  <TableCell>
                    <StatusBadge status={a.status} />
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
