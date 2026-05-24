// Logs 데이터 접근점(단일 교체 지점).
// 백엔드 /api/logs 신설 시 아래 한 줄을 realLogsProvider로 교체하면 됩니다.
import type { LogsProvider } from "./types";
import { mockLogsProvider } from "./mock/mockLogs";

export const logsProvider: LogsProvider = mockLogsProvider;
