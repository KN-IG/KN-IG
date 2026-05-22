// 백엔드 /api/policy 미구현(Non-Goal, 다음 사이클). 콘솔 UI 검증용 합성 mock.
// 실연동 시 policyProvider.ts의 한 줄을 realPolicyProvider로 교체합니다.
import type { PolicyProvider } from "../types";
import type { Policy, PolicyDeployment } from "@/types/contracts";

const POLICIES: Policy[] = [
  { id: "POL-1", name: "기본 무결성 감시", scope: ["/etc", "/usr/bin", "/var/www"], rules: ["수정 차단", "삭제 차단", "권한 변경 알림"] },
  { id: "POL-2", name: "웹 루트 보호", scope: ["/var/www/html"], rules: ["수정 차단", "신규 파일 알림"] },
  { id: "POL-3", name: "DB 설정 보호", scope: ["/etc/mysql", "/var/lib/mysql/conf"], rules: ["수정 차단", "삭제 차단"] },
];

const DEPLOYMENTS: PolicyDeployment[] = [
  { agentId: "agent-01", agent: "web-prod-01", policyId: "POL-2", policy: "웹 루트 보호", appliedAt: "2026-05-23 09:05:40", status: "APPLIED" },
  { agentId: "agent-02", agent: "db-prod-01", policyId: "POL-3", policy: "DB 설정 보호", appliedAt: "2026-05-23 09:06:12", status: "APPLIED" },
  { agentId: "agent-03", agent: "app-stg-01", policyId: "POL-1", policy: "기본 무결성 감시", appliedAt: "2026-05-23 09:30:00", status: "PENDING" },
  { agentId: "agent-04", agent: "app-stg-02", policyId: "POL-1", policy: "기본 무결성 감시", appliedAt: "2026-05-23 09:31:20", status: "FAILED" },
];

export const mockPolicyProvider: PolicyProvider = {
  async policies() {
    return POLICIES;
  },
  async deployments() {
    return DEPLOYMENTS;
  },
};
