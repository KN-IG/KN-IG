"""Pydantic models.

Two contracts live here:

* The *request* models mirror the JSON that the Go backend emits for
  ``internal.FileEvent`` / ``internal.Agent`` / ``internal.Alert``. Those structs
  carry no json tags, so Go marshals them with their exported (PascalCase) field
  names — hence the aliases below.
* ``ReportData`` is the *response* contract rendered by the console's
  ``ReportV2`` component (Frontend/desktop/src/components/report/ReportV2.tsx).
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ──────────────────────────── request models ────────────────────────────


class TimeRange(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    from_: datetime = Field(alias="from")
    to: datetime


class AgentIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    agent_id: str = Field("", alias="AgentID")
    hostname: str = Field("", alias="Hostname")
    ip: str = Field("", alias="IP")
    status: str = Field("", alias="Status")


class ProcessNodeIn(BaseModel):
    """Go internal.ProcessInfo (file_event_process_chain) — PascalCase 필드명 alias."""
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    pid: int = Field(0, alias="PID")
    ppid: int = Field(0, alias="PPID")
    uid: int = Field(0, alias="UID")
    euid: int = Field(0, alias="EUID")
    sid: int = Field(0, alias="SID")
    tty: str = Field("", alias="TTY")
    comm: str = Field("", alias="Comm")
    exe: str = Field("", alias="Exe")
    cmdline: str = Field("", alias="Cmdline")
    start_time_ns: int = Field(0, alias="StartTimeNS")


class EventIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    id: int = Field(0, alias="ID")
    agent_id: str = Field("", alias="AgentID")
    event_type: str = Field("", alias="EventType")
    file_path: str = Field("", alias="FilePath")
    file_name: str = Field("", alias="FileName")
    pid: int = Field(0, alias="Pid")
    detected_by: str = Field("", alias="DetectedBy")
    occurred_at: Optional[datetime] = Field(None, alias="OccurredAt")
    # 직속 actor부터 최상위 조상까지의 프로세스 계보 (depth_index 순). 없으면 빈 리스트.
    chain: List[ProcessNodeIn] = Field(default_factory=list, alias="Chain")


class AlertIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    id: int = Field(0, alias="ID")
    agent_id: str = Field("", alias="AgentID")
    severity: str = Field("", alias="Severity")
    message: str = Field("", alias="Message")
    resolved: bool = Field(False, alias="Resolved")
    created_at: Optional[datetime] = Field(None, alias="CreatedAt")


class ReportRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    range: TimeRange
    agents: List[AgentIn] = Field(default_factory=list)
    events: List[EventIn] = Field(default_factory=list)
    prev_events: List[EventIn] = Field(default_factory=list, alias="prevEvents")
    alerts: List[AlertIn] = Field(default_factory=list)

    @field_validator("agents", "events", "prev_events", "alerts", mode="before")
    @classmethod
    def _none_to_empty(cls, v):
        # Go marshals nil slices as JSON null; treat that as an empty list.
        return [] if v is None else v


# ──────────────────────────── response models ───────────────────────────
# Field names intentionally match the JS DATA contract (camelCase) so the
# report page consumes the JSON unchanged.


class BlockedBySev(BaseModel):
    Critical: List[int]
    High: List[int]
    Medium: List[int]
    Low: List[int]


class SeverityTotals(BaseModel):
    Critical: int
    High: int
    Medium: int
    Low: int


class KPI(BaseModel):
    label: str
    num: int
    delta: str
    tone: str  # "good" | "bad"
    sub: str
    color: str  # "--blue" | "--low" | "--high" | "--crit"
    icon: str  # "folder" | "shield" | "search" | "alert"
    spark: List[int]


class Tech(BaseModel):
    id: str
    nm: str
    n: int


class MatrixColumn(BaseModel):
    tactic: str
    en: str
    tech: List[Tech]


class CampaignPoint(BaseModel):
    host: str
    t: int  # 0..15 position on the campaign ribbon
    sev: str
    label: str


class Finding(BaseModel):
    sev: str  # "crit" | "high" | "low"
    stat: str
    tag: str
    title: str
    body: str


class ChainNode(BaseModel):
    step: int = 1
    name: str = ""
    pid: int = 0
    ppid: int = 0
    exe: str = ""
    cmd: str = ""
    user: str = ""
    tty: str = ""
    note: str = ""
    esc: bool = False
    blocked: bool = False
    tech: str = ""


class Incident(BaseModel):
    sev: str  # "Critical" | "High" | "Medium" | "Low"
    path: str
    host: str
    time: str
    type: str
    action: str
    desc: str
    mitre: List[str]
    kill: List[int]
    detail: str
    finding: str
    chain: List[ChainNode]


class Rec(BaseModel):
    p: int
    sev: str  # "crit" | "high" | "med" | "low"
    title: str
    when: str
    body: str
    link: str


class ReportData(BaseModel):
    days: List[str]
    blockedBySev: BlockedBySev
    prevPeriodDaily: List[int]
    severity: SeverityTotals
    category: List[Tuple[str, int, bool]]
    hosts: List[Tuple[str, int, int]]
    findings: List[Finding]
    kpis: List[KPI]
    attackMatrix: List[MatrixColumn]
    killPhases: List[str]
    campaign: List[CampaignPoint]
    campaignHosts: List[str]
    incidents: List[Incident]
    recs: List[Rec]
    mitreGlossary: List[Tuple[str, str, str]]
    # 스트리밍 모드의 LLM '종합 분석' 내러티브(마크다운). 비스트림 경로에서는 미생성(None).
    executiveSummary: Optional[str] = None
