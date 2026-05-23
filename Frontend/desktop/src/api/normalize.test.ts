import { describe, it, expect } from "vitest";
import { normalizeAgent, normalizeEvent, fmtTime } from "./normalize";

describe("normalizeAgent", () => {
  it("PascalCase raw → camelCase Agent, status 대문자화", () => {
    const a = normalizeAgent({ AgentID: "agent-01", Hostname: "web-prod-01", IP: "10.0.0.5", Status: "online" });
    expect(a).toEqual({ id: "agent-01", hostname: "web-prod-01", ip: "10.0.0.5", status: "ONLINE" });
  });

  it("Hostname/IP 부재 시 폴백, Status 부재 시 UNKNOWN", () => {
    const a = normalizeAgent({ AgentID: "agent-09" });
    expect(a.hostname).toBe("agent-09");
    expect(a.ip).toBe("");
    expect(a.status).toBe("UNKNOWN");
  });
});

describe("normalizeEvent", () => {
  it("EventType 매핑 + agentMap hostname 사용 + 합성 필드", () => {
    const agentMap = { "agent-01": normalizeAgent({ AgentID: "agent-01", Hostname: "web-prod-01" }) };
    const e = normalizeEvent(
      { ID: 42, AgentID: "agent-01", EventType: "MODIFY", OccurredAt: "2026-05-23T09:00:00Z", FilePath: "/etc/passwd" },
      agentMap,
    );
    expect(e.id).toBe("EVT-42");
    expect(e.type).toBe("MODIFIED");
    expect(e.agent).toBe("web-prod-01");
    expect(e.event).toBe("/etc/passwd MODIFIED");
    expect(e.action).toBe("DETECTED"); // Blocked 없음(maintenance/감사) → DETECTED
    expect(e.path).toBe("/etc/passwd");
  });

  it("Blocked=true(lock 모드 실제 차단) → action BLOCKED", () => {
    const e = normalizeEvent(
      { ID: 7, AgentID: "x", EventType: "DELETE", OccurredAt: "", FilePath: "/etc/x", Blocked: true },
      {},
    );
    expect(e.action).toBe("BLOCKED");
  });

  it("미지정 EventType은 원본 유지, agentMap 미스 시 AgentID 폴백", () => {
    const e = normalizeEvent(
      { ID: 1, AgentID: "x", EventType: "WEIRD", OccurredAt: "", FilePath: "/a" },
      {},
    );
    expect(e.type).toBe("WEIRD");
    expect(e.agent).toBe("x");
  });
});

describe("fmtTime", () => {
  it("빈 값/null은 빈 문자열, 잘못된 날짜는 원본 유지", () => {
    expect(fmtTime("")).toBe("");
    expect(fmtTime(null)).toBe("");
    expect(fmtTime("not-a-date")).toBe("not-a-date");
  });
});
