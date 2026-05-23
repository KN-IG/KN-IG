// Policy 페이지 계약 — 에이전트별 정책 편집기.
//
// 사용자 합의: "각 Agent 마다 실제 어떤 디렉토리와 파일을 감시하고 차단할지 설정하는 정책 설정 파일".
// 모델은 에이전트 설정(agent.yaml / ig.conf)을 그대로 반영한다:
//   - watch  : 감시 경로(inotify/fanotify). ig.conf [watch]의 recursive/single, fanotify mount.
//   - protect: 변경/삭제를 차단(block)할 파일·디렉토리. ig.conf [protect].
//
// 백엔드 /api/policy 및 에이전트 원격 설정 수신은 미구현(다음 사이클). dev에서는 mock이
// 저장/배포를 시뮬레이션한다(provider seam). 실연동 시 policyProvider.ts 한 줄을 교체한다.

export type WatchMode = "recursive" | "single" | "mount";

// 감시 경로 한 건.
export interface WatchRule {
  id: string;
  path: string;
  mode: WatchMode;
}

export type ProtectKind = "file" | "dir";

// 차단(보호) 대상 한 건.
export interface ProtectRule {
  id: string;
  path: string;
  kind: ProtectKind;
}

export type DeploymentStatus = "APPLIED" | "PENDING" | "FAILED";

// 에이전트별 정책 전체.
export interface AgentPolicy {
  agentId: string;
  agent: string; // hostname (표시용)
  watch: WatchRule[];
  protect: ProtectRule[];
  updatedAt: string; // 마지막 저장 시각 "YYYY-MM-DD HH:mm:ss"
  status: DeploymentStatus; // 마지막 배포 상태
}

// 편집 초안(저장 시 provider로 전달). updatedAt/status는 서버(mock)가 채운다.
export interface PolicyDraft {
  watch: WatchRule[];
  protect: ProtectRule[];
}
