// Policy 데이터 접근점(단일 교체 지점).
// 백엔드 /api/policy 신설 시 아래 한 줄을 realPolicyProvider로 교체하면 됩니다.
import type { PolicyProvider } from "./types";
import { mockPolicyProvider } from "./mock/mockPolicy";

export const policyProvider: PolicyProvider = mockPolicyProvider;
