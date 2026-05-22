// Provider 인터페이스. mock과 실제 API 구현이 동일 인터페이스를 만족하므로,
// 페이지는 provider를 통해서만 데이터에 접근하고(직접 fetch 금지), 백엔드 신설 시
// 구현 교체가 한 곳(logsProvider.ts/policyProvider.ts)에서 끝납니다.
import type {
  Agent,
  FileEvent,
  Alert,
  SystemLog,
  AuditLog,
  Policy,
  PolicyDeployment,
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

export interface LogsProvider {
  systemLogs(): Promise<SystemLog[]>;
  auditLogs(): Promise<AuditLog[]>;
}

export interface PolicyProvider {
  policies(): Promise<Policy[]>;
  deployments(): Promise<PolicyDeployment[]>;
}
