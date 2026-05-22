import { describe, it, expect } from "vitest";
import { logsProvider } from "./logsProvider";
import { policyProvider } from "./policyProvider";

const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"];
const DEPLOY_STATUS = ["APPLIED", "PENDING", "FAILED"];

describe("mock providers 계약 준수", () => {
  it("logsProvider.systemLogs: SystemLog 필수 필드/enum", async () => {
    const logs = await logsProvider.systemLogs();
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect(typeof l.id).toBe("string");
      expect(typeof l.time).toBe("string");
      expect(typeof l.agentId).toBe("string");
      expect(LOG_LEVELS).toContain(l.level);
      expect(typeof l.message).toBe("string");
    }
  });

  it("logsProvider.auditLogs: AuditLog 필수 필드", async () => {
    const logs = await logsProvider.auditLogs();
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect(typeof l.actor).toBe("string");
      expect(typeof l.action).toBe("string");
      expect(typeof l.target).toBe("string");
    }
  });

  it("policyProvider.policies: scope/rules 배열", async () => {
    const pols = await policyProvider.policies();
    expect(pols.length).toBeGreaterThan(0);
    for (const p of pols) {
      expect(Array.isArray(p.scope)).toBe(true);
      expect(Array.isArray(p.rules)).toBe(true);
      expect(typeof p.name).toBe("string");
    }
  });

  it("policyProvider.deployments: 상태 enum + 매핑 필드", async () => {
    const deps = await policyProvider.deployments();
    expect(deps.length).toBeGreaterThan(0);
    for (const d of deps) {
      expect(DEPLOY_STATUS).toContain(d.status);
      expect(typeof d.agentId).toBe("string");
      expect(typeof d.policy).toBe("string");
    }
  });
});
