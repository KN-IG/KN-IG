"""Deterministic aggregation.

Turns raw events/alerts/agents into the numeric + structural fields of the
report DATA contract. Every count and chart series is computed here so the LLM
never has to invent a number. Prose fields are pre-filled with rule-based
template text (from ``classify``) so the skeleton is already a *valid*,
renderable report even if the LLM is unavailable; ``assemble`` overlays
LLM-written prose on top when it succeeds.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from typing import Dict, Iterable, List, Tuple

from . import classify
from .schemas import ReportRequest

SEV_ORDER = ["Critical", "High", "Medium", "Low"]
_SEV_RANK = {s: i for i, s in enumerate(SEV_ORDER)}


def _dedupe(items: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for item in items:
        if item and item not in seen:
            out.append(item)
            seen.add(item)
    return out


def _day_labels(start: date, end: date) -> List[date]:
    n = (end - start).days
    if n < 0:
        n = 0
    days = [start + timedelta(days=i) for i in range(n + 1)]
    return days[-31:]  # guard against absurd ranges


def _spark(series: List[int]) -> List[int]:
    if len(series) >= 2:
        return series
    if len(series) == 1:
        return series * 2
    return [0, 0]


def _delta_pct(cur: int, prev: int) -> Tuple[str, str]:
    """Returns (delta label, tone) comparing current vs previous totals."""
    if prev <= 0:
        return ("신규" if cur > 0 else "—"), ("bad" if cur > 0 else "good")
    pct = round((cur - prev) / prev * 100)
    if pct > 0:
        return f"▲ {pct}%", "bad"
    if pct < 0:
        return f"▼ {abs(pct)}%", "good"
    return "± 0%", "good"


def _friendly_label(profile: classify.Profile, path: str) -> str:
    return f"{profile.category} ({path})"


def _proc_text(node) -> str:
    return " ".join([
        getattr(node, "comm", "") or "",
        getattr(node, "exe", "") or "",
        getattr(node, "cmdline", "") or "",
    ]).lower()


def _process_techniques(ev) -> List[str]:
    """PID Chain/Actor 증거에서 보강 가능한 ATT&CK 기법을 결정론적으로 추론한다.

    경로 기반 분류만으로는 "무엇을 건드렸는지"는 잘 보이지만 "어떤 실행 흐름으로
    왔는지"가 매트릭스에 빠진다. 여기서는 실제 수집 필드에 근거한 보수적 보강만 한다.
    """
    nodes = list(ev.chain or [])
    if not nodes and (ev.actor_pid or ev.actor_comm or ev.actor_exe or ev.actor_cmdline):
        nodes = [SimpleNamespace(
            comm=ev.actor_comm,
            exe=ev.actor_exe,
            cmdline=ev.actor_cmdline,
            uid=ev.actor_uid,
            euid=ev.actor_euid,
            tty=ev.actor_tty,
        )]

    out: List[str] = []
    for n in nodes:
        text = _proc_text(n)
        comm = (getattr(n, "comm", "") or "").lower()
        exe = (getattr(n, "exe", "") or "").lower()
        tty = getattr(n, "tty", "") or ""
        uid = int(getattr(n, "uid", 0) or 0)
        euid = int(getattr(n, "euid", 0) or 0)

        if uid != euid or "sudo" in comm or exe.endswith("/sudo") or " sudo " in f" {text} ":
            out.append("T1548.003")
        if comm in {"sh", "bash", "dash", "zsh", "ksh"} or exe.endswith(("/sh", "/bash", "/dash", "/zsh", "/ksh")):
            out.append("T1059.004")
        if "python" in comm or "/python" in exe or "python" in text:
            out.append("T1059.006")
        if "sshd" in comm or "/sshd" in exe or tty.startswith("pts"):
            out.append("T1078")

    return _dedupe(out)


def _event_mitre(ev, prof: classify.Profile) -> List[str]:
    """경로 기반 기법 + 프로세스 증거 기반 기법을 합친 사건별 MITRE 목록."""
    return _dedupe([*prof.mitre, *_process_techniques(ev)])


def build_skeleton(req: ReportRequest) -> Dict:
    start = req.range.from_.date()
    end = req.range.to.date()
    day_dates = _day_labels(start, end)
    days = [d.strftime("%m-%d") for d in day_dates]
    n_days = len(days)
    day_index = {d: i for i, d in enumerate(day_dates)}

    agent_name = {a.agent_id: (a.hostname or a.agent_id) for a in req.agents}

    # ── per-day severity buckets + totals ──────────────────────────────
    blocked = {s: [0] * n_days for s in SEV_ORDER}
    sev_total = {s: 0 for s in SEV_ORDER}
    cat_count: Dict[str, int] = defaultdict(int)
    cat_is_critical: Dict[str, bool] = defaultdict(bool)
    host_blocked: Dict[str, int] = defaultdict(int)
    host_unblocked_events: Dict[str, int] = defaultdict(int)
    tech_count: Dict[str, int] = defaultdict(int)  # exact MITRE technique/sub-technique id
    daily_total = [0] * n_days
    daily_blocked = [0] * n_days
    daily_unblocked = [0] * n_days
    daily_crit = [0] * n_days

    for ev in req.events:
        if not ev.file_path:
            continue
        prof = classify.classify(ev.file_path)
        sev = prof.severity
        sev_total[sev] += 1
        cat_count[prof.category] += 1
        cat_is_critical[prof.category] = cat_is_critical[prof.category] or sev == "Critical"
        host = agent_name.get(ev.agent_id, ev.agent_id or "unknown")
        if ev.blocked:
            host_blocked[host] += 1
        else:
            host_unblocked_events[host] += 1
        for t in _event_mitre(ev, prof):
            tech_count[t] += 1
        if ev.occurred_at is not None:
            idx = day_index.get(ev.occurred_at.date())
            if idx is not None:
                if ev.blocked:
                    blocked[sev][idx] += 1
                    daily_blocked[idx] += 1
                else:
                    daily_unblocked[idx] += 1
                daily_total[idx] += 1
                if sev == "Critical":
                    daily_crit[idx] += 1

    # ── previous-period daily totals (for the comparison line) ─────────
    dur = req.range.to - req.range.from_
    prev_start = (req.range.from_ - dur).date()
    prev_index = {prev_start + timedelta(days=i): i for i in range(n_days)}
    prev_daily = [0] * n_days
    prev_crit_total = 0
    prev_unblocked_total = 0
    for ev in req.prev_events:
        if not ev.file_path:
            continue
        if classify.classify(ev.file_path).severity == "Critical":
            prev_crit_total += 1
        if not ev.blocked:
            prev_unblocked_total += 1
        if ev.occurred_at is not None:
            idx = prev_index.get(ev.occurred_at.date())
            if idx is not None:
                prev_daily[idx] += 1

    # ── per-host unblocked (review-needed) from alerts ─────────────────
    host_unblocked: Dict[str, int] = defaultdict(int)
    daily_alerts = [0] * n_days
    for al in req.alerts:
        host_unblocked[agent_name.get(al.agent_id, al.agent_id or "unknown")] += 1
        if al.created_at is not None:
            idx = day_index.get(al.created_at.date())
            if idx is not None:
                daily_alerts[idx] += 1

    total = sum(sev_total.values())
    prev_total = len(req.prev_events)
    blocked_total = sum(1 for ev in req.events if ev.file_path and ev.blocked)
    unblocked_event_total = max(0, total - blocked_total)
    # 미차단 = 실제로 차단되지 않은 이벤트만. 알림(버스트/이상징후)은 '미차단'이 아니다.
    # lock(DENY) 모드에서는 탐지=차단이라 미차단=0(차단율 100%)이 정상이다.
    unblocked_total = unblocked_event_total
    crit_total = sev_total["Critical"]
    block_rate = round(blocked_total / total * 100, 1) if total else 100.0

    # ── category bars (top 8) ──────────────────────────────────────────
    category = [
        [cat, cnt, cat_is_critical.get(cat, False)]
        for cat, cnt in sorted(cat_count.items(), key=lambda kv: kv[1], reverse=True)[:8]
    ]

    # ── host bars (top 6 by activity) ──────────────────────────────────
    host_names = sorted(
        set(host_blocked) | set(host_unblocked_events) | set(host_unblocked),
        key=lambda h: host_blocked[h] + host_unblocked_events[h] + host_unblocked[h],
        reverse=True,
    )[:6]
    hosts = [[h, host_blocked.get(h, 0), host_unblocked_events.get(h, 0)] for h in host_names]

    # ── KPIs ───────────────────────────────────────────────────────────
    d1, t1 = _delta_pct(total, prev_total)
    d3, t3 = _delta_pct(unblocked_total, prev_unblocked_total)
    d4, t4 = _delta_pct(crit_total, prev_crit_total)
    kpis = [
        {"label": "전체 이벤트", "num": total, "delta": d1, "tone": t1,
         "sub": f"전기간 {prev_total}건", "color": "--blue", "icon": "folder", "spark": _spark(daily_total)},
        {"label": "차단 (사전 차단율)", "num": blocked_total, "delta": f"{block_rate}%", "tone": "good",
         "sub": f"차단율 {block_rate}%", "color": "--low", "icon": "shield", "spark": _spark(daily_blocked)},
        {"label": "미차단 · 확인 필요", "num": unblocked_total, "delta": d3, "tone": t3,
         "sub": "사후 탐지 · 추가 조사", "color": "--high", "icon": "search", "spark": _spark(daily_unblocked)},
        {"label": "치명적 자산 표적", "num": crit_total, "delta": d4, "tone": t4,
         "sub": "자격증명·권한·원격접속", "color": "--crit", "icon": "alert", "spark": _spark(daily_crit)},
    ]

    # ── ATT&CK matrix ──────────────────────────────────────────────────
    by_tactic: Dict[str, List[Dict]] = defaultdict(list)
    for tech_id, n in tech_count.items():
        tac_ko, tac_en, _ = classify.tactic_of(tech_id)
        by_tactic[tac_ko].append({"id": tech_id, "nm": classify.tech_name(tech_id), "n": n})
    attack_matrix = []
    for tac_ko, tac_en in classify.TACTIC_ORDER:
        techs = sorted(by_tactic.get(tac_ko, []), key=lambda t: t["n"], reverse=True)
        if techs:
            attack_matrix.append({"tactic": tac_ko, "en": tac_en, "tech": techs})

    # ── incidents (top severity, up to 4) + campaign ───────────────────
    ranked = sorted(
        [e for e in req.events if e.file_path and e.occurred_at is not None],
        key=lambda e: (_SEV_RANK[classify.classify(e.file_path).severity], -e.occurred_at.timestamp()),
    )
    top = ranked[:4]
    incidents = [_incident(ev, agent_name) for ev in top]
    # 캠페인 상관 섹션 제거 — 과장된 '조직적 캠페인' framing을 리포트에서 뺀다.
    # (계약 유지를 위해 빈 배열 반환; 콘솔은 비면 섹션을 렌더하지 않는다)
    campaign, campaign_hosts = [], []

    # ── MITRE glossary for techniques actually seen ────────────────────
    seen_full: set = set()
    for ev in req.events:
        if ev.file_path:
            seen_full.update(_event_mitre(ev, classify.classify(ev.file_path)))
    mitre_glossary = []
    for tid in sorted(seen_full):
        meta = classify.MITRE_GLOSSARY.get(tid)
        if meta:
            mitre_glossary.append([tid, meta[0], meta[1]])

    return {
        "days": days,
        "blockedBySev": {s: blocked[s] for s in SEV_ORDER},
        "prevPeriodDaily": prev_daily,
        "severity": {s: sev_total[s] for s in SEV_ORDER},
        "category": category,
        "hosts": hosts,
        "findings": _template_findings(crit_total, block_rate, unblocked_total, category, hosts),
        "kpis": kpis,
        "attackMatrix": attack_matrix,
        "killPhases": classify.KILL_PHASES,
        "campaign": campaign,
        "campaignHosts": campaign_hosts,
        "incidents": incidents,
        "recs": _template_recs(unblocked_total, hosts, incidents),
        "mitreGlossary": mitre_glossary,
        "executiveSummary": _template_executive_summary(
            total,
            blocked_total,
            block_rate,
            crit_total,
            unblocked_total,
            category,
            hosts,
            incidents,
        ),
    }


def _op(event_type: str) -> Tuple[str, str]:
    """Returns (syscall, korean attempt-type)."""
    et = event_type.upper()
    if et == "DELETE":
        return "unlink", "삭제 시도"
    if et == "MOVE":
        return "rename", "이동/교체 시도"
    if et == "ATTRIB":
        return "chmod/chown", "속성 변경 시도"
    if et == "CREATE":
        return "open/write", "생성 시도"
    return "write", "수정 시도"


def _fmt_user(uid: int, euid: int) -> Tuple[str, bool]:
    """user 표시 문자열과 권한 상승(esc) 여부."""
    esc = uid != euid
    if esc:
        return f"uid {uid} → euid {euid}", True
    if uid == 0:
        return "root (uid 0)", False
    return f"uid {uid}", False


def _node_note(comm: str, tty: str, esc: bool, uid: int, euid: int) -> str:
    """프로세스 노드에 대한 짧은 자동 설명."""
    parts: List[str] = []
    if "sshd" in comm:
        parts.append("원격 SSH 데몬")
    if tty.startswith("pts"):
        parts.append(f"원격 세션({tty})")
    if esc:
        parts.append(f"실행 중 권한 상승 uid {uid}→{euid}")
    return " · ".join(parts)


def _blocked_note(ev) -> str:
    base = "무결성 가드가 시스템 콜 진입 단계에서 차단" if ev.blocked else "무결성 가드가 사후 탐지로 기록"
    if ev.chain_truncated:
        return base + " · PID 계보 일부가 수집 한도에서 잘림"
    return base


def _chain_node_from_proc(n, step: int) -> Dict:
    user, esc = _fmt_user(n.uid, n.euid)
    node = {
        "step": step,
        "name": n.comm or "process",
        "pid": n.pid,
        "ppid": n.ppid,
        "exe": n.exe,
        "user": user,
        "tty": n.tty,
        "note": _node_note(n.comm, n.tty, esc, n.uid, n.euid),
        "esc": esc,
    }
    if n.cmdline:
        node["cmd"] = n.cmdline
    return node


def _build_chain(ev, prof, syscall: str) -> List[Dict]:
    """실제 프로세스 계보(ev.chain)를 리포트 ChainNode 배열로 변환한다.
    저장 순서는 depth_index 0=직속 actor … N=최상위 조상이므로, 공격 진행이
    위→아래로 읽히도록 조상부터(역순) 펼치고 마지막에 차단된 시스템 콜 노드를 붙인다.
    체인 데이터가 없으면 Backend가 함께 보내는 Actor* 필드로 최소 2단계 체인을 만든다."""
    nodes = list(ev.chain or [])
    if nodes:
        actor = nodes[0]  # depth_index 0 = 실제 시도를 수행한 직속 프로세스
        chain: List[Dict] = []
        for i, n in enumerate(reversed(nodes)):
            chain.append(_chain_node_from_proc(n, i + 1))
        actor_user, _ = _fmt_user(actor.uid, actor.euid)
        chain.append({
            "step": len(chain) + 1,
            "name": "차단된 시도" if ev.blocked else "탐지된 시도",
            "pid": actor.pid,
            "ppid": actor.ppid,
            "exe": f"{syscall}() → {ev.file_path}",
            "user": actor_user,
            "note": _blocked_note(ev),
            "blocked": ev.blocked,
            "tech": prof.mitre[0] if prof.mitre else "",
        })
        return chain
    if ev.actor_pid or ev.actor_comm or ev.actor_exe or ev.actor_cmdline:
        actor = SimpleNamespace(
            pid=ev.actor_pid or ev.pid or 0,
            ppid=ev.actor_ppid,
            uid=ev.actor_uid,
            euid=ev.actor_euid,
            sid=ev.actor_sid,
            tty=ev.actor_tty,
            comm=ev.actor_comm or "process",
            exe=ev.actor_exe,
            cmdline=ev.actor_cmdline,
            start_time_ns=ev.actor_start_time_ns,
        )
        node = _chain_node_from_proc(actor, 1)
        actor_user, _ = _fmt_user(actor.uid, actor.euid)
        return [
            node,
            {
                "step": 2,
                "name": "차단된 시도" if ev.blocked else "탐지된 시도",
                "pid": actor.pid,
                "ppid": actor.ppid,
                "exe": f"{syscall}() → {ev.file_path}",
                "user": actor_user,
                "note": _blocked_note(ev),
                "blocked": ev.blocked,
                "tech": prof.mitre[0] if prof.mitre else "",
            },
        ]
    return [{
        "step": 1,
        "name": "차단된 시도" if ev.blocked else "탐지된 시도",
        "pid": ev.pid or 0,
        "ppid": 0,
        "exe": f"{syscall}() → {ev.file_path}",
        "user": "—",
        "note": _blocked_note(ev),
        "blocked": ev.blocked,
        "tech": prof.mitre[0] if prof.mitre else "",
    }]


def _incident(ev, agent_name: Dict[str, str]) -> Dict:
    prof = classify.classify(ev.file_path)
    syscall, attempt = _op(ev.event_type)
    mitre = _event_mitre(ev, prof)
    kill = sorted({classify.tactic_of(t)[2] for t in mitre})
    chain = _build_chain(ev, prof, syscall)
    time_str = ev.occurred_at.strftime("%m-%d %H:%M") if ev.occurred_at else ""
    action = "차단" if ev.blocked else "탐지"
    desc = (
        f"보호 대상 자원 \"{ev.file_path}\"에 대한 {attempt}가 감지되어 차단되었습니다."
        if ev.blocked
        else f"보호 대상 자원 \"{ev.file_path}\"에 대한 {attempt}가 사후 탐지되었습니다. 실제 변경 여부 확인이 필요합니다."
    )
    return {
        "sev": prof.severity,
        "path": ev.file_path,
        "host": agent_name.get(ev.agent_id, ev.agent_id or "unknown"),
        "time": time_str,
        "type": attempt,
        "action": action,
        "desc": desc,
        "mitre": mitre,
        "kill": kill or [0],
        "detail": prof.role,
        "finding": (prof.scenarios[0] if prof.scenarios else prof.role),
        "chain": chain,
    }


def _campaign(events, agent_name: Dict[str, str]) -> Tuple[List[Dict], List[str]]:
    events = [e for e in events if e.occurred_at is not None]
    if not events:
        return [], []
    events = sorted(events, key=lambda e: e.occurred_at)
    n = len(events)
    pts = []
    hosts: List[str] = []
    for i, ev in enumerate(events):
        prof = classify.classify(ev.file_path)
        host = agent_name.get(ev.agent_id, ev.agent_id or "unknown")
        if host not in hosts:
            hosts.append(host)
        t = round(i * 15 / (n - 1)) if n > 1 else 7
        label = f"{ev.file_path.split('/')[-1] or ev.file_path} {ev.occurred_at.strftime('%H:%M')}"
        pts.append({"host": host, "t": t, "sev": prof.severity, "label": label})
    return pts, hosts


def _template_findings(crit, rate, unblocked, category, hosts) -> List[Dict]:
    top_cat = category[0][0] if category else "보호 자원"
    top_host = hosts[0][0] if hosts else "감시 호스트"
    return [
        {"sev": "crit", "stat": f"{crit}건", "tag": "치명적 표적",
         "title": "치명적 자산 대상 시도", "body": f"이번 기간 치명적 등급 시도 {crit}건이 관측됐습니다. 가장 많이 노려진 자산은 \"{top_cat}\"입니다."},
        {"sev": "low", "stat": f"{rate}% 차단", "tag": f"차단율 {rate}%",
         "title": "위협 사전 차단", "body": "탐지된 변조 시도를 시스템 콜 단계에서 사전 차단했습니다. 미차단 항목은 변경 여부 확인이 필요합니다."},
        {"sev": "high", "stat": top_host, "tag": "호스트 집중",
         "title": "특정 호스트 집중", "body": f"\"{top_host}\" 호스트에서 시도가 가장 많이 관측됐습니다. 해당 호스트의 로그인·프로세스 이력 확보를 권고합니다."},
    ]


def _template_recs(unblocked_total: int, hosts: List[List], incidents: List[Dict]) -> List[Dict]:
    top_host = hosts[0][0] if hosts else "시도 발생 호스트"
    incident_links = "·".join(f"#{i + 1}" for i in range(min(len(incidents), 4))) or "전체 사건"
    unblocked_label = f"사후 탐지 {unblocked_total}건" if unblocked_total else "사후 탐지 항목"
    return [
        {"p": 1, "sev": "crit", "title": f"{top_host} 집중 점검", "when": "권장 시점 · 즉시 (1시간 이내)",
         "body": "시도가 집중된 호스트의 로그인 기록과 프로세스 실행 내역을 확보해 시도 주체(UID·PID·부모 프로세스)를 식별합니다.", "link": f"관련 사건 {incident_links}"},
        {"p": 2, "sev": "crit", "title": "자격증명·접속 설정 무결성 재검증", "when": "권장 시점 · 즉시 (1시간 이내)",
         "body": "비밀번호 파일과 원격 접속 설정의 베이스라인 해시를 현재 값과 대조해 무단 변경 여부를 확인합니다.", "link": "치명적 자산 KPI 연계"},
        {"p": 3, "sev": "high", "title": f"{unblocked_label} 개별 점검", "when": "권장 시점 · 24시간 이내",
         "body": "차단되지 않고 탐지된 건은 실제 변경 여부가 불확실합니다. 변경 전후 상태를 확인하고 필요 시 복구합니다.", "link": "미차단 KPI 연계"},
        {"p": 4, "sev": "med", "title": "증적 보존 후 보안팀 이관", "when": "권장 시점 · 24시간 이내",
         "body": "사건을 사건관리 시스템에 등록하고 표준 증적을 보존한 뒤 SOC로 이관해 추적 감시를 요청합니다.", "link": f"관련 사건 {incident_links}"},
    ]


def _template_executive_summary(
    total: int,
    blocked_total: int,
    block_rate: float,
    crit_total: int,
    unblocked_total: int,
    category: List[List],
    hosts: List[List],
    incidents: List[Dict],
) -> str:
    """LLM 실패·쿼터 상황에서도 프론트 '종합 분석' 영역이 비지 않게 하는 근거 기반 요약."""
    if total <= 0:
        return (
            "## 종합 분석\n"
            "선택 기간에는 보호 경로 변조 이벤트가 관측되지 않았습니다. 현재 상태를 기준선으로 보존하고, "
            "Agent 연결 상태와 정책 배포 상태를 계속 모니터링하세요."
        )

    top_cat = category[0][0] if category else "보호 자원"
    top_host = hosts[0][0] if hosts else "감시 호스트"
    first = incidents[0] if incidents else {}
    first_path = first.get("path", "주요 보호 경로")
    first_mitre = ", ".join(first.get("mitre", [])[:3]) or "ATT&CK 매핑"
    unblocked_sentence = (
        f"미차단·확인 필요 항목 {unblocked_total}건은 실제 변경 여부와 운영 작업 승인 기록을 우선 대조해야 합니다."
        if unblocked_total
        else "미차단·확인 필요 항목은 없어 차단 정책이 전반적으로 정상 작동한 것으로 해석됩니다."
    )
    return (
        "## 종합 분석\n"
        f"선택 기간 동안 총 {total}건의 보호 경로 이벤트가 관측됐고, 이 중 {blocked_total}건이 사전 차단되어 "
        f"차단율은 {block_rate}%입니다. 치명적 자산 표적은 {crit_total}건이며, 주요 표적 범주는 "
        f"'{top_cat}', 집중 호스트는 '{top_host}'입니다.\n"
        f"대표 사건은 '{first_path}' 관련 시도로, PID Chain과 프로세스 증거를 기반으로 {first_mitre} 기법에 "
        f"연결됩니다. {unblocked_sentence}"
    )
