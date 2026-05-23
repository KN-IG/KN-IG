// 백엔드 로그 스트림(/api/agents/:id/logs) 미구현 — 콘솔 UI 검증용 합성 mock.
// 실연동 시 logsProvider.ts의 한 줄을 realLogsProvider로 교체합니다.
//
// streamAgentLogs: 구독 즉시 최근 ~40줄 백필 → 이후 임의 간격(0.6~2.0s)으로 신규 라인을 push.
// tail -f 처럼 끊김 없이 흐르도록 setTimeout 체인으로 구현하고, 정리 함수로 타이머를 끊는다.
import type { LogsProvider, LogStreamHandlers } from "../types";
import type { AgentLogLine, AuditLog, LogLevel, LogSource } from "@/types/contracts";

let seq = 0;
function nextId(): string {
  seq += 1;
  return `LOG-${seq}`;
}

function clock(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 에이전트별 경로 힌트(로그 메시지에 끼워 현실감 부여). 정책 mock과 톤을 맞춘다.
const PATH_HINTS: Record<string, { watch: string[]; protect: string[] }> = {
  "agent-01": {
    watch: ["/var/www/html", "/etc/nginx", "/var/www/html/uploads"],
    protect: ["/var/www/html/config.php", "/usr/local/bin/agent"],
  },
  "agent-02": {
    watch: ["/etc/mysql", "/var/lib/mysql/conf", "/etc"],
    protect: ["/etc/mysql/my.cnf", "/etc/ssh/sshd_config"],
  },
  "agent-03": {
    watch: ["/opt/app/config", "/etc"],
    protect: ["/opt/app/config/app.yaml"],
  },
  "agent-04": {
    watch: ["/opt/scada", "/etc", "/boot/grub"],
    protect: ["/opt/scada/runtime.cfg", "/boot/grub/grub.cfg"],
  },
};
const DEFAULT_HINT = { watch: ["/etc", "/usr/bin"], protect: ["/etc/passwd"] };

const COMMS = ["bash", "vim", "scp", "python3", "cp", "rm", "tar", "sshd", "cron"];

interface Template {
  level: LogLevel;
  source: LogSource;
  message: string; // {wpath}/{ppath}/{n}/{pid}/{comm} 치환
}

// 라인 후보 — 평상시 INFO/DEBUG 다수, 가끔 WARN/ERROR(차단/연결).
const TEMPLATES: Template[] = [
  { level: "INFO", source: "inotify", message: "감시 경로 등록: {wpath}" },
  { level: "DEBUG", source: "inotify", message: "이벤트 큐 처리 {n}건 (watch={wpath})" },
  { level: "DEBUG", source: "inotify", message: "디렉토리 워치 갱신 {n}건" },
  { level: "INFO", source: "scanner", message: "베이스라인 스캔 시작" },
  { level: "INFO", source: "scanner", message: "스캔 완료 — 변경 {n}건 감지" },
  { level: "DEBUG", source: "ebpf", message: "who-data 추적: pid={pid} comm={comm}" },
  { level: "DEBUG", source: "lkm", message: "프로세스 캐시 갱신 {n}건" },
  { level: "INFO", source: "transport", message: "이벤트 {n}건 서버 전송 완료" },
  { level: "DEBUG", source: "transport", message: "하트비트 송신 (seq={n})" },
  { level: "WARN", source: "transport", message: "서버 응답 지연 — 재시도 {n}회" },
  { level: "WARN", source: "core", message: "하트비트 응답 지연" },
  { level: "INFO", source: "core", message: "설정을 다시 불러왔습니다" },
  { level: "WARN", source: "fanotify", message: "차단: {ppath} 수정 시도 (pid={pid}, comm={comm})" },
  { level: "ERROR", source: "fanotify", message: "차단: {ppath} 삭제 시도 거부 (pid={pid}, comm={comm})" },
  { level: "ERROR", source: "core", message: "서버 연결 끊김 — 재연결을 시도합니다" },
];

function makeLine(agentId: string, at = new Date()): AgentLogLine {
  const hint = PATH_HINTS[agentId] ?? DEFAULT_HINT;
  const t = pick(TEMPLATES);
  const sub = (s: string, token: string, val: string) => s.split(token).join(val);
  let message = t.message;
  message = sub(message, "{wpath}", pick(hint.watch));
  message = sub(message, "{ppath}", pick(hint.protect));
  message = sub(message, "{n}", String(1 + Math.floor(Math.random() * 12)));
  message = sub(message, "{pid}", String(1000 + Math.floor(Math.random() * 60000)));
  message = sub(message, "{comm}", pick(COMMS));
  return {
    id: nextId(),
    ts: clock(at),
    agentId,
    level: t.level,
    source: t.source,
    message,
  };
}

const BACKFILL_COUNT = 40;

const AUDIT_LOGS: AuditLog[] = [
  { id: "AUD-1", time: "2026-05-23 08:55:11", actor: "admin", action: "로그인", target: "콘솔 세션", detail: "PIN 인증 성공" },
  { id: "AUD-2", time: "2026-05-23 09:05:40", actor: "admin", action: "정책 배포", target: "web-prod-01", detail: "웹 루트 보호 정책 적용" },
  { id: "AUD-3", time: "2026-05-23 09:40:22", actor: "admin", action: "보고서 생성", target: "EVT-1042", detail: "무결성 위반 보고서" },
  { id: "AUD-4", time: "2026-05-23 10:02:18", actor: "admin", action: "에이전트 삭제", target: "app-old-09", detail: "비활성 에이전트 정리" },
];

export const mockLogsProvider: LogsProvider = {
  async auditLogs() {
    return AUDIT_LOGS;
  },

  streamAgentLogs(agentId, handlers: LogStreamHandlers, opts) {
    const live = opts?.live ?? true;

    // 백필: 최근 BACKFILL_COUNT줄(과거→현재 순). ts를 ~4초 간격으로 거슬러 채운다.
    const now = Date.now();
    const backfill: AgentLogLine[] = [];
    for (let i = BACKFILL_COUNT; i > 0; i--) {
      backfill.push(makeLine(agentId, new Date(now - i * 4000)));
    }
    handlers.onBackfill(backfill);

    if (!live) return () => {};

    // 신규 라인 push — 가변 간격 setTimeout 체인.
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      handlers.onLine(makeLine(agentId));
      timer = setTimeout(tick, 600 + Math.random() * 1400);
    };
    timer = setTimeout(tick, 500 + Math.random() * 800);
    return () => clearTimeout(timer);
  },
};
