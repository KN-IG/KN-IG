// 백엔드 없이 UI를 테스트하기 위한 mock 코어 데이터(config.useMock일 때 coreProviders가 사용).
// 경로는 PATH_PROFILES 매칭/DEFAULT 폴백 둘 다 섞어 Report 보고서가 다양하게 생성되게 했다.
import type { Agent, FileEvent, Alert } from "@/types/contracts";

export const MOCK_AGENTS: Agent[] = [
  { id: "agent-01", hostname: "web-prod-01", ip: "10.0.1.11", status: "ONLINE", os: "Ubuntu 24.04.1 LTS", kernel: "6.8.0-31-generic", guardian: "eBPF LSM" },
  { id: "agent-02", hostname: "db-prod-01", ip: "10.0.1.21", status: "ONLINE", os: "Rocky Linux 9.3", kernel: "5.14.0-362.el9", guardian: "LKM415" },
  { id: "agent-03", hostname: "app-stg-01", ip: "10.0.2.31", status: "OFFLINE", os: "CentOS 7.9", kernel: "3.10.0-1160.el7", guardian: "LKM310" },
  { id: "agent-04", hostname: "hist-ot-01", ip: "10.0.3.41", status: "ONLINE", os: "Ubuntu 16.04.7 LTS", kernel: "4.15.0-142-generic", guardian: "LKM42" },
];

function ts(hoursAgo: number, minAgo = 0): string {
  const d = new Date(Date.now() - hoursAgo * 3_600_000 - minAgo * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

interface Seed {
  path: string;
  type: "MODIFIED" | "DELETED";
  agent: number;
  h: number;
}

const SEEDS: Seed[] = [
  { path: "/etc/shadow", type: "MODIFIED", agent: 0, h: 0 },
  { path: "/etc/passwd", type: "MODIFIED", agent: 0, h: 1 },
  { path: "/var/www/html/config.php", type: "MODIFIED", agent: 0, h: 2 },
  { path: "/etc/mysql/my.cnf", type: "DELETED", agent: 1, h: 3 },
  { path: "/usr/bin/sshd", type: "MODIFIED", agent: 1, h: 4 },
  { path: "/boot/grub/grub.cfg", type: "MODIFIED", agent: 3, h: 5 },
  { path: "/etc/crontab", type: "MODIFIED", agent: 3, h: 6 },
  { path: "/var/spool/cron/root", type: "DELETED", agent: 2, h: 7 },
  { path: "/etc/ssh/sshd_config", type: "MODIFIED", agent: 1, h: 9 },
  { path: "/opt/scada/runtime.cfg", type: "MODIFIED", agent: 3, h: 11 },
  { path: "/etc/hosts", type: "MODIFIED", agent: 0, h: 13 },
  { path: "/var/log/audit/audit.log", type: "DELETED", agent: 2, h: 18 },
];

export const MOCK_EVENTS: FileEvent[] = SEEDS.map((s, i) => {
  const ag = MOCK_AGENTS[s.agent];
  return {
    id: `EVT-${1000 + i}`,
    time: ts(s.h, i * 3),
    agent: ag.hostname,
    agentId: ag.id,
    event: `${s.path} ${s.type}`,
    type: s.type,
    action: "BLOCKED",
    path: s.path,
    pid: 1200 + i,
    detectedBy: "integrity-guard",
  };
});

export const MOCK_ALERTS: Alert[] = [
  { id: "ALR-1", agentId: "agent-01", agent: "web-prod-01", severity: "HIGH", message: "/etc/shadow 변조 시도가 반복 감지되었습니다.", resolved: false, time: ts(0, 5) },
  { id: "ALR-2", agentId: "agent-02", agent: "db-prod-01", severity: "MEDIUM", message: "DB 설정 파일 삭제 시도가 차단되었습니다.", resolved: false, time: ts(3, 0) },
  { id: "ALR-3", agentId: "agent-03", agent: "app-stg-01", severity: "LOW", message: "에이전트 연결이 끊어졌습니다.", resolved: false, time: ts(7, 0) },
];
