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
from typing import Dict, List, Tuple

from . import classify
from .schemas import ReportRequest

SEV_ORDER = ["Critical", "High", "Medium", "Low"]
_SEV_RANK = {s: i for i, s in enumerate(SEV_ORDER)}


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
    cat_sev: Dict[str, str] = {}
    host_blocked: Dict[str, int] = defaultdict(int)
    tech_count: Dict[str, int] = defaultdict(int)  # by base id
    daily_total = [0] * n_days
    daily_crit = [0] * n_days

    for ev in req.events:
        if not ev.file_path:
            continue
        prof = classify.classify(ev.file_path)
        sev = prof.severity
        sev_total[sev] += 1
        cat_count[prof.category] += 1
        cat_sev[prof.category] = sev
        host_blocked[agent_name.get(ev.agent_id, ev.agent_id or "unknown")] += 1
        for t in prof.mitre:
            tech_count[classify.base_id(t)] += 1
        if ev.occurred_at is not None:
            idx = day_index.get(ev.occurred_at.date())
            if idx is not None:
                blocked[sev][idx] += 1
                daily_total[idx] += 1
                if sev == "Critical":
                    daily_crit[idx] += 1

    # ── previous-period daily totals (for the comparison line) ─────────
    dur = req.range.to - req.range.from_
    prev_start = (req.range.from_ - dur).date()
    prev_index = {prev_start + timedelta(days=i): i for i in range(n_days)}
    prev_daily = [0] * n_days
    prev_crit_total = 0
    for ev in req.prev_events:
        if not ev.file_path:
            continue
        if classify.classify(ev.file_path).severity == "Critical":
            prev_crit_total += 1
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
    blocked_total = total  # current agent emits BLOCKED-only events
    unblocked_total = len(req.alerts)
    crit_total = sev_total["Critical"]
    block_rate = round(blocked_total / (blocked_total + unblocked_total) * 100, 1) if (blocked_total + unblocked_total) else 100.0

    # ── category bars (top 8) ──────────────────────────────────────────
    category = [
        [cat, cnt, cat_sev.get(cat) == "Critical"]
        for cat, cnt in sorted(cat_count.items(), key=lambda kv: kv[1], reverse=True)[:8]
    ]

    # ── host bars (top 6 by activity) ──────────────────────────────────
    host_names = sorted(
        set(host_blocked) | set(host_unblocked),
        key=lambda h: host_blocked[h] + host_unblocked[h],
        reverse=True,
    )[:6]
    hosts = [[h, host_blocked.get(h, 0), host_unblocked.get(h, 0)] for h in host_names]

    # ── KPIs ───────────────────────────────────────────────────────────
    d1, t1 = _delta_pct(total, prev_total)
    d3, t3 = _delta_pct(unblocked_total, 0)
    d4, t4 = _delta_pct(crit_total, prev_crit_total)
    kpis = [
        {"label": "전체 이벤트", "num": total, "delta": d1, "tone": t1,
         "sub": f"전기간 {prev_total}건", "color": "--blue", "icon": "folder", "spark": _spark(daily_total)},
        {"label": "차단 (사전 차단율)", "num": blocked_total, "delta": f"{block_rate}%", "tone": "good",
         "sub": f"차단율 {block_rate}%", "color": "--low", "icon": "shield", "spark": _spark(daily_total)},
        {"label": "미차단 · 확인 필요", "num": unblocked_total, "delta": d3, "tone": t3,
         "sub": "사후 탐지 · 추가 조사", "color": "--high", "icon": "search", "spark": _spark(daily_alerts)},
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
    campaign, campaign_hosts = _campaign(ranked[:6], agent_name)

    # ── MITRE glossary for techniques actually seen ────────────────────
    seen_full: set = set()
    for ev in req.events:
        if ev.file_path:
            seen_full.update(classify.classify(ev.file_path).mitre)
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
        "recs": _template_recs(),
        "mitreGlossary": mitre_glossary,
    }


def _op(event_type: str) -> Tuple[str, str]:
    """Returns (syscall, korean attempt-type)."""
    if event_type.upper() in ("DELETE", "MOVE"):
        return "unlink", "삭제 시도"
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


def _build_chain(ev, prof, syscall: str) -> List[Dict]:
    """실제 프로세스 계보(ev.chain)를 리포트 ChainNode 배열로 변환한다.
    저장 순서는 depth_index 0=직속 actor … N=최상위 조상이므로, 공격 진행이
    위→아래로 읽히도록 조상부터(역순) 펼치고 마지막에 차단된 시스템 콜 노드를 붙인다.
    체인 데이터가 없으면 단일 합성 노드로 폴백한다(기존 동작)."""
    nodes = list(ev.chain or [])
    if nodes:
        actor = nodes[0]  # depth_index 0 = 실제 시도를 수행한 직속 프로세스
        chain: List[Dict] = []
        for i, n in enumerate(reversed(nodes)):
            user, esc = _fmt_user(n.uid, n.euid)
            chain.append({
                "step": i + 1,
                "name": n.comm or "process",
                "pid": n.pid,
                "ppid": n.ppid,
                "exe": n.exe,
                "cmd": n.cmdline or "",
                "user": user,
                "tty": n.tty,
                "note": _node_note(n.comm, n.tty, esc, n.uid, n.euid),
                "esc": esc,
            })
        actor_user, _ = _fmt_user(actor.uid, actor.euid)
        chain.append({
            "step": len(chain) + 1,
            "name": "차단된 시도",
            "pid": actor.pid,
            "ppid": actor.ppid,
            "exe": f"{syscall}() → {ev.file_path}",
            "user": actor_user,
            "note": "무결성 가드가 시스템 콜 진입 단계에서 차단",
            "blocked": True,
            "tech": prof.mitre[0] if prof.mitre else "",
        })
        return chain
    return [{
        "step": 1,
        "name": "차단된 시도",
        "pid": ev.pid or 0,
        "ppid": 0,
        "exe": f"{syscall}() → {ev.file_path}",
        "user": "—",
        "note": "무결성 가드가 시스템 콜 진입 단계에서 차단",
        "blocked": True,
        "tech": prof.mitre[0] if prof.mitre else "",
    }]


def _incident(ev, agent_name: Dict[str, str]) -> Dict:
    prof = classify.classify(ev.file_path)
    syscall, attempt = _op(ev.event_type)
    kill = sorted({classify.tactic_of(t)[2] for t in prof.mitre})
    chain = _build_chain(ev, prof, syscall)
    time_str = ev.occurred_at.strftime("%m-%d %H:%M") if ev.occurred_at else ""
    return {
        "sev": prof.severity,
        "path": ev.file_path,
        "host": agent_name.get(ev.agent_id, ev.agent_id or "unknown"),
        "time": time_str,
        "type": attempt,
        "action": "차단",
        "desc": f"보호 대상 자원 \"{ev.file_path}\"에 대한 {attempt}가 감지되어 차단되었습니다.",
        "mitre": list(prof.mitre),
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


def _template_recs() -> List[Dict]:
    return [
        {"p": 1, "sev": "crit", "title": "집중 시도 호스트 점검", "when": "권장 시점 · 즉시 (1시간 이내)",
         "body": "시도가 집중된 호스트의 로그인 기록과 프로세스 실행 내역을 확보해 시도 주체(UID·PID·부모 프로세스)를 식별합니다.", "link": "관련 사건 #1"},
        {"p": 2, "sev": "crit", "title": "자격증명·접속 설정 무결성 재검증", "when": "권장 시점 · 즉시 (1시간 이내)",
         "body": "비밀번호 파일과 원격 접속 설정의 베이스라인 해시를 현재 값과 대조해 무단 변경 여부를 확인합니다.", "link": "치명적 자산 KPI 연계"},
        {"p": 3, "sev": "high", "title": "사후 탐지 건 개별 점검", "when": "권장 시점 · 24시간 이내",
         "body": "차단되지 않고 탐지된 건은 실제 변경 여부가 불확실합니다. 변경 전후 상태를 확인하고 필요 시 복구합니다.", "link": "미차단 KPI 연계"},
        {"p": 4, "sev": "med", "title": "증적 보존 후 보안팀 이관", "when": "권장 시점 · 24시간 이내",
         "body": "사건을 사건관리 시스템에 등록하고 표준 증적을 보존한 뒤 SOC로 이관해 추적 감시를 요청합니다.", "link": "전체 사건 연계"},
    ]
