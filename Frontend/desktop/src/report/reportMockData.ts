// 주간 종합 리포트 mock 데이터. 원본 이식: report-demo-v2.html DATA 객체.
// /api/reports/summary 응답과 동일 형태. useMock/연동 실패 시 폴백(시퀀스 7).

export interface ReportSeverity {
  Critical: number;
  High: number;
  Medium: number;
  Low: number;
}
export interface ReportFinding {
  sev: "crit" | "high" | "low" | string;
  stat: string;
  tag: string;
  title: string;
  body: string;
}
export interface ReportKpi {
  label: string;
  num: number;
  delta: string;
  tone: "bad" | "good" | "neutral" | string;
  sub: string;
  color: string; // CSS 변수명 (--blue 등)
  icon: "folder" | "shield" | "search" | "alert" | string;
  spark: number[];
}
export interface AttackTactic {
  tactic: string;
  en: string;
  tech: { id: string; nm: string; n: number }[];
}
export interface CampaignDot {
  host: string;
  t: number; // 15:00 기준 경과 분 (0–15)
  sev: string;
  label: string;
}
export interface ChainNode {
  step: number;
  name: string;
  pid: number;
  ppid: number;
  exe: string;
  cmd?: string;
  user: string;
  tty?: string;
  note: string;
  esc?: boolean;
  blocked?: boolean;
  tech?: string;
}
export interface Incident {
  sev: "Critical" | "High" | "Medium" | "Low" | string;
  path: string;
  host: string;
  time: string;
  type: string;
  action: string;
  desc: string;
  mitre: string[];
  kill: number[];
  detail: string;
  finding: string;
  chain: ChainNode[];
}
export interface ReportRec {
  p: number;
  sev: "crit" | "high" | "med" | "low" | string;
  title: string;
  when: string;
  body: string;
  link: string;
}

export interface ReportSummary {
  days: string[];
  blockedBySev: Record<"Critical" | "High" | "Medium" | "Low", number[]>;
  prevPeriodDaily: number[];
  severity: ReportSeverity;
  category: [string, number, boolean][];
  hosts: [string, number, number][];
  findings: ReportFinding[];
  kpis: ReportKpi[];
  attackMatrix: AttackTactic[];
  killPhases: string[];
  campaign: CampaignDot[];
  campaignHosts: string[];
  incidents: Incident[];
  recs: ReportRec[];
  mitreGlossary: [string, string, string][];
}

export const MOCK_REPORT: ReportSummary = {
  days: ["05-14", "05-15", "05-16", "05-17", "05-18", "05-19", "05-20"],
  blockedBySev: {
    Critical: [1, 1, 2, 1, 8, 4, 3],
    High: [3, 2, 4, 4, 13, 8, 7],
    Medium: [5, 4, 6, 6, 14, 11, 9],
    Low: [3, 2, 3, 3, 6, 5, 4],
  },
  prevPeriodDaily: [12, 10, 13, 12, 15, 14, 13],
  severity: { Critical: 22, High: 47, Medium: 61, Low: 30 },
  category: [
    ["로그인 자격증명 (/etc/shadow)", 31, true],
    ["관리자 권한 설정 (/etc/sudoers)", 24, true],
    ["원격 접속 설정 (/etc/ssh)", 19, true],
    ["예약 작업 (cron)", 22, false],
    ["시스템 서비스 (systemd)", 17, false],
    ["네트워크 설정", 14, false],
    ["애플리케이션 설정", 19, false],
    ["로그 파일 (/var/log)", 14, false],
  ],
  hosts: [
    ["HMI-01", 63, 8],
    ["EWS-02", 45, 4],
    ["Historian-03", 34, 6],
  ],
  findings: [
    {
      sev: "crit",
      stat: "3 호스트 · 6분",
      tag: "조직적 캠페인",
      title: "동시 다발 자격증명 표적",
      body: "5/18 15:01–15:06 사이 HMI-01·EWS-02·Historian-03에서 비밀번호·권한·원격접속 파일을 거의 동시에 노렸습니다. 단일 위협 주체의 조직적 시도로 추정됩니다.",
    },
    {
      sev: "low",
      stat: "100% 차단",
      tag: "차단율 88.8%",
      title: "치명적 위협 전부 사전 차단",
      body: "치명적 등급 22건을 실제 변경 전에 모두 막았습니다. 미차단 18건은 사후 탐지로, 변경 여부 확인이 필요합니다.",
    },
    {
      sev: "high",
      stat: "4개 사건 동일",
      tag: "권한 상승 패턴",
      title: "권한 상승 후 변조 반복",
      body: "일반 계정이 sudo·스크립트로 root 권한(euid 0)을 획득한 직후 보호 파일을 변경하려는 동일 패턴이 모든 사건에서 관측됐습니다.",
    },
  ],
  kpis: [
    { label: "전체 이벤트", num: 160, delta: "▲ 23%", tone: "bad", sub: "전기간 130건", color: "--blue", icon: "folder", spark: [96, 110, 104, 118, 130, 124, 160] },
    { label: "차단 (사전 차단율)", num: 142, delta: "88.8%", tone: "good", sub: "전기간 87.1%", color: "--low", icon: "shield", spark: [101, 98, 112, 120, 116, 122, 142] },
    { label: "미차단 · 확인 필요", num: 18, delta: "▲ 6", tone: "bad", sub: "전기간 12건", color: "--high", icon: "search", spark: [9, 11, 8, 13, 12, 15, 18] },
    { label: "치명적 자산 표적", num: 22, delta: "▲ 9", tone: "bad", sub: "전기간 13건", color: "--crit", icon: "alert", spark: [7, 9, 8, 11, 13, 12, 22] },
  ],
  attackMatrix: [
    { tactic: "초기 접근", en: "Initial Access", tech: [{ id: "T1078", nm: "유효 계정", n: 6 }] },
    { tactic: "자격증명 접근", en: "Credential Access", tech: [{ id: "T1003", nm: "자격증명 추출", n: 28 }] },
    { tactic: "권한 상승", en: "Privilege Esc.", tech: [{ id: "T1548", nm: "Sudo 악용", n: 12 }, { id: "T1068", nm: "취약점 악용", n: 7 }] },
    { tactic: "지속성", en: "Persistence", tech: [{ id: "T1098", nm: "계정 조작", n: 21 }, { id: "T1543", nm: "systemd 서비스", n: 17 }, { id: "T1053", nm: "cron 작업", n: 15 }] },
    { tactic: "방어 회피", en: "Defense Evasion", tech: [{ id: "T1556", nm: "인증 변조", n: 11 }, { id: "T1070", nm: "로그 삭제", n: 9 }] },
    { tactic: "영향", en: "Impact", tech: [{ id: "T1565", nm: "데이터 변조", n: 8 }] },
  ],
  killPhases: ["초기 접근", "권한 상승", "자격증명 접근", "방어 회피", "영향"],
  campaign: [
    { host: "HMI-01", t: 1, sev: "Critical", label: "/etc/shadow 15:01" },
    { host: "EWS-02", t: 3, sev: "Critical", label: "/etc/sudoers.d 15:03" },
    { host: "Historian-03", t: 6, sev: "Critical", label: "/etc/ssh/sshd_config 15:06" },
    { host: "HMI-01", t: 12, sev: "Low", label: "audit.log 삭제 15:12" },
  ],
  campaignHosts: ["HMI-01", "EWS-02", "Historian-03"],
  incidents: [
    {
      sev: "Critical", path: "/etc/shadow", host: "HMI-01", time: "05-18 15:01", type: "수정 시도", action: "차단",
      desc: "운영 계정 비밀번호를 무단 변경하려는 시도로, 영구 접근 경로 확보 정황이 있습니다.",
      mitre: ["T1003.008", "T1098"], kill: [0, 1, 2, 4],
      detail: "초기 침투에 성공한 위협 주체가 운영 계정 비밀번호를 임의 값으로 재설정해 지속적 접근 통로를 확보하려는 시도로 추정됩니다. KN-IG가 변경 직전에 차단하여 실제 변경은 발생하지 않았습니다.",
      finding: "원격 셸 세션(pts/2)의 일반 계정(operator)이 python3 실행 중 root로 상승(uid 1000 → euid 0)한 직후 /etc/shadow 변경을 시도했습니다.",
      chain: [
        { step: 1, name: "sshd", pid: 812, ppid: 1, exe: "/usr/sbin/sshd", user: "root", tty: "—", note: "원격 SSH 접속을 수락한 데몬" },
        { step: 2, name: "bash", pid: 1340, ppid: 812, exe: "/bin/bash", user: "operator (uid 1000)", tty: "pts/2", note: "원격 세션 셸 — pts/2는 원격 접속 정황" },
        { step: 3, name: "python3", pid: 1502, ppid: 1340, exe: "/usr/bin/python3", cmd: "python3 /tmp/.sysupd.py", user: "uid 1000 → euid 0", tty: "pts/2", note: "실행 중 root 권한으로 상승", esc: true, tech: "T1068" },
        { step: 4, name: "차단된 시도", pid: 1502, ppid: 1340, exe: "write() → /etc/shadow", user: "euid 0", note: "무결성 가드가 시스템 콜 단계에서 차단", blocked: true, tech: "T1003.008" },
      ],
    },
    {
      sev: "Critical", path: "/etc/sudoers.d/zz_temp", host: "EWS-02", time: "05-18 15:03", type: "수정 시도", action: "차단",
      desc: "일반 계정에 관리자 권한을 부여하려는 정책 파일 삽입 시도입니다.",
      mitre: ["T1548.003"], kill: [0, 1, 4],
      detail: "권한 설정 디렉터리에 임시 정책 파일을 삽입해 비인가 계정에 관리자 권한을 부여하려는 권한 상승 시도입니다. 파일명을 'zz_'로 시작해 정책 적용 우선순위를 높이려 한 점에서 의도적 우회로 판단됩니다.",
      finding: "operator 계정이 sudo로 root 권한을 획득한 뒤, sudoers.d에 영구 권한 부여 정책 파일을 심으려 시도했습니다.",
      chain: [
        { step: 1, name: "sshd", pid: 905, ppid: 1, exe: "/usr/sbin/sshd", user: "root", tty: "—", note: "원격 SSH 접속 수락" },
        { step: 2, name: "bash", pid: 2210, ppid: 905, exe: "/bin/bash", user: "operator (uid 1000)", tty: "pts/1", note: "원격 세션 셸" },
        { step: 3, name: "sudo", pid: 2333, ppid: 2210, exe: "/usr/bin/sudo", cmd: "sudo -s", user: "uid 1000 → euid 0", tty: "pts/1", note: "sudo로 root 권한 획득", esc: true, tech: "T1548.003" },
        { step: 4, name: "bash", pid: 2334, ppid: 2333, exe: "/bin/bash", user: "root (euid 0)", tty: "pts/1", note: "상승된 root 셸" },
        { step: 5, name: "차단된 시도", pid: 2334, ppid: 2333, exe: "write() → /etc/sudoers.d/zz_temp", user: "euid 0", note: "권한 정책 파일 삽입을 차단", blocked: true, tech: "T1098" },
      ],
    },
    {
      sev: "Critical", path: "/etc/ssh/sshd_config", host: "Historian-03", time: "05-18 15:06", type: "수정 시도", action: "차단",
      desc: "외부에서 관리자로 직접 접속할 수 있도록 원격 접속 설정을 변경하려는 시도입니다.",
      mitre: ["T1556", "T1098.004"], kill: [0, 1, 4],
      detail: "SSH 설정에서 관리자 직접 로그인 및 인증 우회를 허용하려는 시도로, 외부의 지속 접근 통로를 확보하려는 정황입니다. Historian은 공정 데이터를 보관하는 핵심 자산이므로 가용성·무결성 영향이 큽니다.",
      finding: "서비스 계정(svc-historian)이 sudo로 권한 상승 후 sed로 sshd_config의 PermitRootLogin을 활성화하려 시도했습니다.",
      chain: [
        { step: 1, name: "sshd", pid: 770, ppid: 1, exe: "/usr/sbin/sshd", user: "root", tty: "—", note: "원격 SSH 접속 수락" },
        { step: 2, name: "bash", pid: 3401, ppid: 770, exe: "/bin/bash", user: "svc-historian (uid 1001)", tty: "pts/0", note: "서비스 계정 원격 셸" },
        { step: 3, name: "sudo", pid: 3500, ppid: 3401, exe: "/usr/bin/sudo", cmd: "sudo sed -i ...", user: "uid 1001 → euid 0", tty: "pts/0", note: "sudo로 권한 상승", esc: true, tech: "T1548.003" },
        { step: 4, name: "sed", pid: 3501, ppid: 3500, exe: "/usr/bin/sed", cmd: "sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/'", user: "root (euid 0)", tty: "pts/0", note: "sshd_config 인증 설정 변경 시도", tech: "T1556" },
        { step: 5, name: "차단된 시도", pid: 3501, ppid: 3500, exe: "write() → /etc/ssh/sshd_config", user: "euid 0", note: "원격 접속 설정 변경을 차단", blocked: true, tech: "T1556" },
      ],
    },
    {
      sev: "Low", path: "/var/log/audit/audit.log", host: "HMI-01", time: "05-18 15:12", type: "삭제 시도", action: "차단",
      desc: "감사 로그를 삭제해 흔적을 제거하려는 정황입니다. (등급은 낮으나 의심 활동)",
      mitre: ["T1070.002"], kill: [0, 1, 3],
      detail: "로그 삭제 자체의 직접 피해는 작으나, 앞선 자격증명 변조 시도 직후에 발생해 흔적 은폐를 목적으로 한 후속 행위로 추정됩니다. 단독으로는 Low 등급이나 선행 사건과 연계해 보면 위험 신호입니다.",
      finding: "사건 #1과 동일한 python3 프로세스(PID 1502)가 shadow 변경 시도 직후 감사 로그를 삭제해 흔적을 지우려 했습니다.",
      chain: [
        { step: 1, name: "sshd", pid: 812, ppid: 1, exe: "/usr/sbin/sshd", user: "root", tty: "—", note: "사건 #1과 동일 세션" },
        { step: 2, name: "bash", pid: 1340, ppid: 812, exe: "/bin/bash", user: "operator (uid 1000)", tty: "pts/2", note: "동일 원격 셸" },
        { step: 3, name: "python3", pid: 1502, ppid: 1340, exe: "/usr/bin/python3", cmd: "python3 /tmp/.sysupd.py", user: "uid 1000 → euid 0", tty: "pts/2", note: "shadow 시도와 동일 프로세스", esc: true, tech: "T1068" },
        { step: 4, name: "차단된 시도", pid: 1502, ppid: 1340, exe: "unlink() → /var/log/audit/audit.log", user: "euid 0", note: "감사 로그 삭제(흔적 은폐)를 차단", blocked: true, tech: "T1070.002" },
      ],
    },
  ],
  recs: [
    { p: 1, sev: "crit", title: "5/18 집중 시도 호스트 점검", when: "권장 시점 · 즉시 (1시간 이내)", body: "HMI-01·EWS-02·Historian-03의 로그인 기록과 프로세스 실행 내역을 확보해 시도 주체(UID·PID·부모 프로세스)를 식별합니다.", link: "관련 사건 #1·#2·#3·#4" },
    { p: 2, sev: "crit", title: "자격증명·접속 설정 무결성 재검증", when: "권장 시점 · 즉시 (1시간 이내)", body: "비밀번호 파일과 원격 접속 설정의 베이스라인 해시를 현재 값과 대조해 무단 변경 여부를 확인합니다.", link: "관련 사건 #1·#3" },
    { p: 3, sev: "high", title: "사후 탐지 18건 개별 점검", when: "권장 시점 · 24시간 이내", body: "차단되지 않고 탐지된 18건은 실제 변경 여부가 불확실합니다. 변경 전후 상태를 확인하고 필요 시 복구합니다.", link: "미차단 KPI 연계" },
    { p: 4, sev: "med", title: "증적 보존 후 보안팀 이관", when: "권장 시점 · 24시간 이내", body: "사건을 사건관리 시스템에 등록하고 표준 증적을 보존한 뒤, SOC에 이관하여 추적 감시를 요청합니다.", link: "관련 사건 #4 (로그 삭제)" },
  ],
  mitreGlossary: [
    ["T1003.008", "OS 자격증명 추출 (/etc/passwd & /etc/shadow)", "시스템에 저장된 로그인 자격증명을 비인가 경로로 획득하려는 행위입니다."],
    ["T1098", "계정 조작", "기존 계정의 인증 정보나 권한을 임의로 변경해 지속적인 접근 통로를 확보합니다."],
    ["T1548.003", "Sudo 및 Sudo 캐싱 악용", "sudo 권한 정책을 악용해 일반 계정이 관리자 권한을 획득합니다."],
    ["T1556", "인증 절차 변조", "로그인 검증 과정 자체를 조작해 정상 인증을 우회합니다."],
    ["T1543.002", "systemd 서비스 생성/변조", "정상 서비스로 위장한 서비스를 등록해 재부팅 후에도 지속성을 확보합니다."],
    ["T1053.003", "예약 작업 (cron)", "cron에 작업을 심어 주기적 실행과 지속성을 확보합니다."],
    ["T1070.002", "로그 삭제", "시스템·감사 로그를 삭제해 공격 흔적을 제거하고 탐지를 회피합니다."],
  ],
};
