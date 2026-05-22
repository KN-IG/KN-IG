// Policy 페이지 계약.
// 사용자 합의(deep-interview R2): "에이전트별 정책 배포 관리"(Agent↔Policy 매핑/배포 현황).
//
// [BACKEND-CONTRACT — 잠정 mock 스키마]
// 백엔드 /api/policy 는 미구현(Non-Goal, 다음 사이클). 아래는 mock 계약이며,
// 백엔드 신설 시 합의·확정해야 합니다 (open-questions.md #1):
//   Policy.scope : 정책 적용 범위(감시 경로/호스트 그룹). 잠정 string[].
//                  PATH_PROFILES(api.js:79) 경로 분류를 서버화하는 방향과 연계 가능.
//   Policy.rules : 규칙 목록. 잠정 string[](후속: 구조화 규칙 객체로 확장 가능).

export interface Policy {
  id: string;
  name: string;
  scope: string[];
  rules: string[];
}

export type DeploymentStatus = "APPLIED" | "PENDING" | "FAILED";

// 에이전트별 정책 배포 현황(Agent ↔ Policy 매핑).
export interface PolicyDeployment {
  agentId: string;
  agent: string; // hostname (표시용)
  policyId: string;
  policy: string; // 정책 이름(표시용)
  appliedAt: string;
  status: DeploymentStatus;
}
