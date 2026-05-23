// Provider 인터페이스. mock과 실제 API 구현이 동일 인터페이스를 만족하므로,
// 페이지는 provider를 통해서만 데이터에 접근하고(직접 fetch 금지), 백엔드 신설 시
// 구현 교체가 한 곳(logsProvider.ts/policyProvider.ts)에서 끝납니다.
import type {
  Agent,
  FileEvent,
  Alert,
  AgentLogLine,
  AuditLog,
  AgentPolicy,
  PolicyDraft,
} from "@/types/contracts";

export interface AgentsProvider {
  list(): Promise<Agent[]>;
}

export interface EventsProvider {
  list(limit?: number): Promise<FileEvent[]>;
}

export interface AlertsProvider {
  list(): Promise<Alert[]>;
  resolve(id: string): Promise<void>;
}

// 실시간 로그 스트림 핸들러. 구독 즉시 onBackfill로 최근 라인을 한 번,
// 이후 신규 라인마다 onLine을 호출한다.
export interface LogStreamHandlers {
  onBackfill: (lines: AgentLogLine[]) => void;
  onLine: (line: AgentLogLine) => void;
}

export interface LogsProvider {
  auditLogs(): Promise<AuditLog[]>;
  // 에이전트 로그 tail. live=false면 백필만 하고 신규 라인은 보내지 않는다(오프라인 등).
  // 반환값은 구독 해제 함수(타이머/스트림 정리).
  streamAgentLogs(
    agentId: string,
    handlers: LogStreamHandlers,
    opts?: { live?: boolean },
  ): () => void;
}

export interface PolicyProvider {
  list(): Promise<AgentPolicy[]>;
  // 초안 저장 → status=PENDING(미배포 변경). 저장된 정책을 반환한다.
  save(agentId: string, draft: PolicyDraft): Promise<AgentPolicy>;
  // 배포 → status=APPLIED. 배포된 정책을 반환한다.
  deploy(agentId: string): Promise<AgentPolicy>;
}
