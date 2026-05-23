// 백엔드 /api/policy 미구현 — 콘솔 UI 검증용 합성 mock(에이전트별 정책 편집기).
// 실연동 시 policyProvider.ts의 한 줄을 realPolicyProvider로 교체합니다.
//
// 시드는 agent.yaml / ig.conf 모델을 그대로 반영한다(watch=감시 경로, protect=차단 대상).
// save/deploy는 인메모리 STORE를 변형해 저장(PENDING)·배포(APPLIED) 흐름을 시뮬레이션한다.
import type { PolicyProvider } from "../types";
import type { AgentPolicy, PolicyDraft } from "@/types/contracts";

let rid = 0;
const rowId = (p: string) => `${p}-${(rid += 1)}`;

function now(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 깊은 복사 — 외부에서 STORE를 직접 변형하지 못하게 한다(React 상태와 분리).
function clone(p: AgentPolicy): AgentPolicy {
  return {
    ...p,
    watch: p.watch.map((w) => ({ ...w })),
    protect: p.protect.map((r) => ({ ...r })),
  };
}

const STORE: Record<string, AgentPolicy> = {
  "agent-01": {
    agentId: "agent-01",
    agent: "web-prod-01",
    watch: [
      { id: rowId("w"), path: "/var/www/html", mode: "recursive" },
      { id: rowId("w"), path: "/etc/nginx", mode: "single" },
    ],
    protect: [
      { id: rowId("p"), path: "/var/www/html/config.php", kind: "file" },
      { id: rowId("p"), path: "/usr/local/bin/agent", kind: "file" },
    ],
    updatedAt: "2026-05-23 09:05:40",
    status: "APPLIED",
  },
  "agent-02": {
    agentId: "agent-02",
    agent: "db-prod-01",
    watch: [
      { id: rowId("w"), path: "/etc/mysql", mode: "recursive" },
      { id: rowId("w"), path: "/var/lib/mysql/conf", mode: "single" },
    ],
    protect: [
      { id: rowId("p"), path: "/etc/mysql/my.cnf", kind: "file" },
      { id: rowId("p"), path: "/etc/ssh/sshd_config", kind: "file" },
    ],
    updatedAt: "2026-05-23 09:06:12",
    status: "APPLIED",
  },
  "agent-03": {
    agentId: "agent-03",
    agent: "app-stg-01",
    watch: [
      { id: rowId("w"), path: "/etc", mode: "recursive" },
      { id: rowId("w"), path: "/usr/bin", mode: "single" },
    ],
    protect: [{ id: rowId("p"), path: "/opt/app/config/app.yaml", kind: "file" }],
    updatedAt: "2026-05-23 09:30:00",
    status: "PENDING",
  },
  "agent-04": {
    agentId: "agent-04",
    agent: "hist-ot-01",
    watch: [
      { id: rowId("w"), path: "/opt/scada", mode: "mount" },
      { id: rowId("w"), path: "/boot/grub", mode: "single" },
    ],
    protect: [
      { id: rowId("p"), path: "/opt/scada/runtime.cfg", kind: "file" },
      { id: rowId("p"), path: "/boot/grub", kind: "dir" },
    ],
    updatedAt: "2026-05-23 09:31:20",
    status: "FAILED",
  },
};

export const mockPolicyProvider: PolicyProvider = {
  async list() {
    return Object.values(STORE).map(clone);
  },

  async save(agentId, draft: PolicyDraft) {
    const cur = STORE[agentId];
    if (!cur) throw new Error(`알 수 없는 에이전트: ${agentId}`);
    STORE[agentId] = {
      ...cur,
      watch: draft.watch.map((w) => ({ ...w })),
      protect: draft.protect.map((r) => ({ ...r })),
      updatedAt: now(),
      status: "PENDING", // 저장만 한 상태(미배포 변경)
    };
    return clone(STORE[agentId]);
  },

  async deploy(agentId) {
    const cur = STORE[agentId];
    if (!cur) throw new Error(`알 수 없는 에이전트: ${agentId}`);
    await delay(450); // 배포 왕복 시뮬레이션
    STORE[agentId] = { ...cur, status: "APPLIED", updatedAt: now() };
    return clone(STORE[agentId]);
  },
};
