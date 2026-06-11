"""Tests for the KN-IG LLM report server.

Run from the LLM/ directory:  python -m pytest

These run without any API key, so the LLM narrative path is skipped and the
deterministic template prose is exercised — that is the path that must always
produce a valid report.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import classify
from app.aggregate import build_skeleton
from app.assemble import build_report
from app.main import app
from app.schemas import ReportData, ReportRequest

RANGE = {"from": "2026-05-14T00:00:00Z", "to": "2026-05-21T00:00:00Z"}


@pytest.fixture(autouse=True)
def _force_template(monkeypatch):
    """Exercise the deterministic + template-prose path, independent of any
    configured key, .env, network or provider quota."""
    monkeypatch.setattr("app.llm.narrative.generate", lambda skeleton: None)


def _ev(eid, agent, etype, path, when, pid=0, **extra):
    data = {
        "ID": eid, "AgentID": agent, "EventType": etype, "FilePath": path,
        "FileName": path.rsplit("/", 1)[-1], "Pid": pid, "DetectedBy": "ebpf",
        "OccurredAt": when,
    }
    data.update(extra)
    return data


def _req(**over):
    base = {
        "range": RANGE,
        "agents": [{"AgentID": "a1", "Hostname": "HMI-01", "IP": "10.0.0.1", "Status": "online"}],
        "events": [
            _ev(1, "a1", "MODIFY", "/etc/shadow", "2026-05-18T15:01:00Z", 1502),
            _ev(2, "a1", "MODIFY", "/etc/ssh/sshd_config", "2026-05-18T15:06:00Z", 3501),
            _ev(3, "a1", "DELETE", "/var/log/audit/audit.log", "2026-05-19T10:00:00Z", 1502),
        ],
        "prevEvents": [_ev(90, "a1", "MODIFY", "/etc/shadow", "2026-05-09T12:00:00Z")],
        "alerts": [{"ID": 1, "AgentID": "a1", "Severity": "HIGH", "Message": "burst", "Resolved": False, "CreatedAt": "2026-05-18T15:13:00Z"}],
    }
    base.update(over)
    return ReportRequest(**base)


# ── request model ──────────────────────────────────────────────────────


def test_null_slices_coerce_to_empty():
    req = ReportRequest(range=RANGE, agents=None, events=None, prevEvents=None, alerts=None)
    assert req.events == [] and req.agents == [] and req.prev_events == [] and req.alerts == []


def test_pascalcase_aliases_parse():
    req = _req()
    assert req.events[0].file_path == "/etc/shadow"
    assert req.events[0].pid == 1502


# ── classification grounding ───────────────────────────────────────────


@pytest.mark.parametrize(
    "path,severity",
    [
        ("/etc/shadow", "Critical"),
        ("/etc/ssh/sshd_config", "Critical"),
        ("/etc/sudoers.d/x", "Critical"),
        ("/var/log/audit/audit.log", "High"),
        ("/etc/crontab", "High"),
        ("/etc/systemd/system/node-healthcheck.service", "High"),
        ("/tmp/.x", "Medium"),
        ("/some/unknown/path", "Medium"),  # default profile
    ],
)
def test_classify_severity(path, severity):
    assert classify.classify(path).severity == severity


def test_classify_returns_mitre_in_glossary():
    prof = classify.classify("/etc/shadow")
    assert prof.mitre
    for t in prof.mitre:
        assert t in classify.MITRE_GLOSSARY or classify.base_id(t) in classify.MITRE_GLOSSARY


# ── deterministic aggregation ──────────────────────────────────────────


def test_severity_totals_and_blocked_sum_match():
    d = build_skeleton(_req())
    total = sum(d["severity"].values())
    assert total == 3  # three classifiable events
    by_day = sum(sum(v) for v in d["blockedBySev"].values())
    assert by_day == total  # every event lands in exactly one (day, severity) bucket
    assert d["severity"]["Critical"] == 2  # shadow + sshd_config
    assert d["severity"]["High"] == 1  # audit.log


def test_hosts_use_hostname_then_fallback_to_id():
    d = build_skeleton(_req(events=[_ev(1, "a1", "MODIFY", "/etc/shadow", "2026-05-18T15:01:00Z"),
                                    _ev(2, "ghost", "MODIFY", "/etc/passwd", "2026-05-18T16:00:00Z")]))
    names = {h[0] for h in d["hosts"]}
    assert "HMI-01" in names      # known agent → hostname
    assert "ghost" in names       # unknown agent → falls back to agent_id


def test_kpi_sparks_have_min_two_points():
    d = build_skeleton(_req())
    assert all(len(k["spark"]) >= 2 for k in d["kpis"])


def test_campaign_t_within_ribbon_range():
    d = build_skeleton(_req())
    assert all(0 <= c["t"] <= 15 for c in d["campaign"])


def test_glossary_only_for_seen_techniques():
    d = build_skeleton(_req())
    seen = set()
    for ev in _req().events:
        seen.update(tech["id"] for col in d["attackMatrix"] for tech in col["tech"])
    assert {g[0] for g in d["mitreGlossary"]}.issubset(seen)


def test_blocked_flag_drives_blocked_and_unblocked_kpis():
    d = build_skeleton(_req(events=[
        _ev(1, "a1", "MODIFY", "/etc/shadow", "2026-05-18T15:01:00Z", Blocked=True),
        _ev(2, "a1", "MODIFY", "/etc/passwd", "2026-05-18T16:01:00Z", Blocked=False),
    ], alerts=[]))
    assert d["kpis"][0]["num"] == 2
    assert d["kpis"][1]["num"] == 1
    assert d["kpis"][1]["delta"] == "50.0%"
    assert d["kpis"][2]["num"] == 1
    assert sum(d["blockedBySev"]["Critical"]) == 1


def test_pid_chain_uses_real_chain_and_process_mitre():
    chain = [
        {
            "PID": 1502, "PPID": 1340, "UID": 1000, "EUID": 0, "SID": 1200,
            "TTY": "pts/2", "Comm": "python3", "Exe": "/usr/bin/python3",
            "Cmdline": "python3 /tmp/.sysupd.py", "StartTimeNS": 1,
        },
        {
            "PID": 1340, "PPID": 812, "UID": 1000, "EUID": 1000, "SID": 1200,
            "TTY": "pts/2", "Comm": "bash", "Exe": "/bin/bash",
            "Cmdline": "bash", "StartTimeNS": 1,
        },
        {
            "PID": 812, "PPID": 1, "UID": 0, "EUID": 0, "SID": 812,
            "TTY": "", "Comm": "sshd", "Exe": "/usr/sbin/sshd",
            "Cmdline": "/usr/sbin/sshd -D", "StartTimeNS": 1,
        },
    ]
    d = build_skeleton(_req(events=[
        _ev(1, "a1", "MODIFY", "/etc/shadow", "2026-05-18T15:01:00Z", 1502,
            ChainDepth=3, Chain=chain),
    ], alerts=[]))
    inc = d["incidents"][0]
    assert [n["name"] for n in inc["chain"][:3]] == ["sshd", "bash", "python3"]
    assert inc["chain"][-1]["blocked"] is True
    assert "T1548.003" in inc["mitre"]  # uid 1000 → euid 0 / sudo-like privilege escalation evidence
    assert "T1078" in inc["mitre"]      # sshd/pts remote session evidence
    matrix_ids = {tech["id"] for col in d["attackMatrix"] for tech in col["tech"]}
    assert {"T1003.008", "T1548.003", "T1078"}.issubset(matrix_ids)


def test_actor_fields_are_used_when_full_chain_missing():
    d = build_skeleton(_req(events=[
        _ev(
            1, "a1", "DELETE", "/var/log/audit/audit.log", "2026-05-18T15:01:00Z", 2200,
            ActorPID=2200, ActorPPID=1340, ActorUID=1000, ActorEUID=0,
            ActorTTY="pts/1", ActorComm="sudo", ActorExe="/usr/bin/sudo", ActorCmdline="sudo rm audit.log",
            ChainDepth=0, Chain=None,
        ),
    ], alerts=[]))
    chain = d["incidents"][0]["chain"]
    assert len(chain) == 2
    assert chain[0]["name"] == "sudo"
    assert chain[0]["esc"] is True
    assert chain[1]["exe"].startswith("unlink()")


# ── assembly + fallback ────────────────────────────────────────────────


def test_build_report_valid_and_has_template_prose():
    data = build_report(_req())
    assert isinstance(data, ReportData)
    d = data.model_dump()
    assert len(d) == 16  # 15 + executiveSummary
    assert d["executiveSummary"]
    assert "종합 분석" in d["executiveSummary"]
    assert len(d["findings"]) >= 1 and all(f["title"] and f["body"] for f in d["findings"])
    assert len(d["recs"]) == 4
    assert all(inc["detail"] and inc["finding"] for inc in d["incidents"])


def test_llm_patch_adds_valid_mitre_without_dropping_grounded_ids(monkeypatch):
    monkeypatch.setattr("app.llm.narrative.generate", lambda skeleton: {
        "incidents": [{"index": 0, "mitre": ["T1548.003"], "sev": "High"}],
        "executiveSummary": "## 요약\n근거 기반 보강",
    })
    data = build_report(_req(events=[
        _ev(1, "a1", "MODIFY", "/etc/shadow", "2026-05-18T15:01:00Z"),
    ], alerts=[]))
    inc = data.model_dump()["incidents"][0]
    assert "T1003.008" in inc["mitre"]  # 경로 기반 기존 근거 유지
    assert "T1548.003" in inc["mitre"]  # AI가 제안한 유효 기법 추가
    matrix_ids = {tech["id"] for col in data.model_dump()["attackMatrix"] for tech in col["tech"]}
    assert "T1548.003" in matrix_ids


def test_empty_input_is_valid_report():
    data = build_report(ReportRequest(range=RANGE, agents=[], events=[], prevEvents=[], alerts=[]))
    d = data.model_dump()
    assert sum(d["severity"].values()) == 0
    assert d["incidents"] == [] and d["campaign"] == []
    assert d["executiveSummary"]
    assert len(d["days"]) >= 1  # still a valid time axis


# ── HTTP endpoint ──────────────────────────────────────────────────────


def test_health_endpoint():
    c = TestClient(app)
    r = c.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_summary_endpoint_returns_full_contract():
    c = TestClient(app)
    body = {
        "range": RANGE,
        "agents": [{"AgentID": "a1", "Hostname": "HMI-01", "IP": "10.0.0.1", "Status": "online"}],
        "events": [_ev(1, "a1", "MODIFY", "/etc/shadow", "2026-05-18T15:01:00Z", 1502)],
        "prevEvents": None,
        "alerts": None,
    }
    r = c.post("/v1/reports/summary", json=body)
    assert r.status_code == 200
    d = r.json()
    expected = {"days", "blockedBySev", "prevPeriodDaily", "severity", "category", "hosts",
                "findings", "kpis", "attackMatrix", "killPhases", "campaign", "campaignHosts",
                "incidents", "recs", "mitreGlossary", "executiveSummary"}
    assert set(d.keys()) == expected
