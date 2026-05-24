import { describe, it, expect } from "vitest";
import { logsProvider } from "./logsProvider";
import { policyProvider } from "./policyProvider";
import type { AgentLogLine } from "@/types/contracts";

const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"];
const DEPLOY_STATUS = ["APPLIED", "PENDING", "FAILED"];
const WATCH_MODES = ["recursive", "single", "mount"];

describe("mock logsProvider 계약 준수", () => {
  it("auditLogs: AuditLog 필수 필드", async () => {
    const logs = await logsProvider.auditLogs();
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect(typeof l.actor).toBe("string");
      expect(typeof l.action).toBe("string");
      expect(typeof l.target).toBe("string");
    }
  });

  it("streamAgentLogs: 백필 → 신규 라인 → 정리", async () => {
    const backfill: AgentLogLine[] = [];
    const live: AgentLogLine[] = [];
    const stop = logsProvider.streamAgentLogs("agent-01", {
      onBackfill: (b) => backfill.push(...b),
      onLine: (l) => live.push(l),
    });

    // 백필은 즉시 — agentId/level enum 검증.
    expect(backfill.length).toBeGreaterThan(0);
    for (const l of backfill) {
      expect(l.agentId).toBe("agent-01");
      expect(LOG_LEVELS).toContain(l.level);
      expect(typeof l.message).toBe("string");
    }

    // 신규 라인이 흘러들어온다.
    await new Promise((r) => setTimeout(r, 2200));
    expect(live.length).toBeGreaterThan(0);

    // 정리 후에는 더 들어오지 않는다.
    stop();
    const after = live.length;
    await new Promise((r) => setTimeout(r, 1500));
    expect(live.length).toBe(after);
  });

  it("streamAgentLogs: live=false면 백필만", async () => {
    const live: AgentLogLine[] = [];
    let backfilled = 0;
    const stop = logsProvider.streamAgentLogs(
      "agent-03",
      { onBackfill: (b) => (backfilled = b.length), onLine: (l) => live.push(l) },
      { live: false },
    );
    expect(backfilled).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 1200));
    expect(live.length).toBe(0);
    stop();
  });
});

describe("mock policyProvider 계약 준수", () => {
  it("list: AgentPolicy 구조(watch/protect/enum)", async () => {
    const pols = await policyProvider.list();
    expect(pols.length).toBeGreaterThan(0);
    for (const p of pols) {
      expect(typeof p.agentId).toBe("string");
      expect(typeof p.agent).toBe("string");
      expect(Array.isArray(p.watch)).toBe(true);
      expect(Array.isArray(p.protect)).toBe(true);
      expect(DEPLOY_STATUS).toContain(p.status);
      for (const w of p.watch) expect(WATCH_MODES).toContain(w.mode);
      for (const r of p.protect) expect(["file", "dir"]).toContain(r.kind);
    }
  });

  it("save → PENDING, deploy → APPLIED", async () => {
    const [p] = await policyProvider.list();
    const saved = await policyProvider.save(p.agentId, { watch: p.watch, protect: p.protect });
    expect(saved.status).toBe("PENDING");
    const deployed = await policyProvider.deploy(p.agentId);
    expect(deployed.status).toBe("APPLIED");
  });
});
