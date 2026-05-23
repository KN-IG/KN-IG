// 무결성 위반 보고서 생성(mock).
// 후속: POST /api/reports/generate로 교체(현재 클라이언트 mock LLM).
import { classifyPath } from "./pathProfiles";
import type { FileEvent } from "@/types/contracts";

export interface ReportSection {
  title: string;
  body: string;
}

export interface Report {
  eventId: string;
  generatedAt: string;
  severity: string;
  sections: ReportSection[];
}

const REPORT_STORE = new Map<string, Report>();

export function hasReport(eventId: string): boolean {
  return REPORT_STORE.has(eventId);
}

export function getReport(eventId: string): Report | undefined {
  return REPORT_STORE.get(eventId);
}

export async function generateReport(event: FileEvent): Promise<Report> {
  // Mock LLM call — replace with POST /api/reports/generate
  await new Promise((r) => setTimeout(r, 1200));

  const profile = classifyPath(event.path);
  const verb = event.type === "DELETED" ? "삭제(unlink)" : "변경(write)";
  const blockedClause =
    event.action === "BLOCKED"
      ? "무결성 가드가 시스템 콜 진입 단계에서 본 시도를 거부하였으며, 실제 파일 시스템 변경은 발생하지 않았습니다. 따라서 시스템은 본 시점에 안전한 상태로 유지되었습니다."
      : "본 사건은 차단 없이 사후 발견된 사례이므로, 실제 변경 발생 여부를 별도로 확인할 필요가 있습니다.";

  const report: Report = {
    eventId: event.id,
    generatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    severity: profile.severity,
    sections: [
      {
        title: "1. 사건 개요",
        body: `${event.time}, 에이전트 ${event.agent} 호스트에서 보호 대상으로 등록된 자원 "${event.path}" 에 대한 ${verb} 시도가 감지되었습니다.\n\n${blockedClause}\n\n본 자원은 "${profile.category}" 분류에 해당하며, OT 환경의 운영 안정성 및 안전성에 직접적 영향을 미칠 수 있는 핵심 자산으로 식별됩니다.`,
      },
      {
        title: "2. 영향 자산 분석",
        body: `[자산 정보]\n• 자원 경로: ${event.path}\n• 자산 분류: ${profile.category}\n• 호스트: ${event.agent}\n• 시도 유형: ${event.type === "DELETED" ? "삭제(DELETED)" : "변경(MODIFIED)"}\n• 차단 결과: ${event.action}\n\n[자원의 역할]\n${profile.role}`,
      },
      {
        title: "3. OT 환경 관점에서의 영향",
        body: `${profile.otImpact}\n\n[보충 사항]\nOT 환경의 보안 위험은 단순한 정보 보호(C, Confidentiality) 측면을 넘어 가용성(A, Availability), 무결성(I, Integrity), 그리고 안전성(Safety) 영향까지 포괄하여 평가되어야 합니다. 본 사건은 무결성 손상 시도를 가드가 차단한 사례이나, 동일한 시도가 반복되거나 다른 보호 경로에서도 관찰될 경우 표적화된 OT 침해 캠페인의 일부일 가능성을 검토해야 합니다.`,
      },
      {
        title: "4. 위험도 평가",
        body: `[판정 결과]\n${profile.severity}\n\n[판정 근거]\n본 자원은 시스템 보안 통제 또는 OT 운영 통제의 핵심에 위치하며, 무결성 손상 시 단일 호스트 영향을 넘어 인접 시스템(PLC, SIS, Historian, MES 등)으로 영향이 전파될 가능성이 있습니다.\n\n[가중 요소]\n동일 호스트 또는 동일 OT 영역(Zone) 내 다른 보호 경로에 대한 연쇄 시도가 관찰될 경우, 위험도를 한 단계 상향 조정하여 표적 침해 가능성을 우선 검토해야 합니다.`,
      },
      {
        title: "5. 공격 기법 분류 (MITRE ATT&CK 매핑)",
        body:
          `MITRE ATT&CK은 전 세계 보안 산업이 공유하는 공격 기법 표준 분류 체계입니다. 본 사건과 연관성이 높은 기법은 다음과 같습니다.\n\n` +
          profile.mitre.map((t) => `■ [${t.id}] ${t.title}\n  ${t.desc}`).join("\n\n"),
      },
      {
        title: "6. 예상 공격 시나리오",
        body:
          `본 시도의 의도에 대한 가설은 다음과 같으며, 실제 의도는 후속 조사를 통해 확정되어야 합니다.\n\n` +
          profile.scenarios.map((s, i) => `■ 시나리오 ${i + 1}\n  ${s}`).join("\n\n"),
      },
      {
        title: "7. 탐지 및 차단 메커니즘",
        body: `본 사건의 탐지 및 차단은 무결성 가드의 사전 차단(pre-emptive blocking) 메커니즘에 의해 수행되었습니다.\n\n[처리 단계]\n1. 호스트 ${event.agent}에서 임의의 프로세스가 자원 "${event.path}"에 대한 ${verb} 시스템 콜을 호출하였습니다.\n\n2. 무결성 가드가 시스템 콜 진입 단계에서 본 호출을 가로채어, 보호 경로 베이스라인과의 일치 여부를 검증하였습니다.\n\n3. 일치 항목이 확인되어, 가드는 호출 측에 권한 거부 응답을 반환하여 시스템 콜의 후속 진행을 차단하였습니다.\n\n4. 차단 사실이 백엔드 관제 시스템으로 전송되었으며, 본 보고서 생성의 트리거가 되었습니다.\n\n[결과]\n${event.action === "BLOCKED" ? `자원 "${event.path}" 의 무결성은 유지되었으며, 시도 측에는 권한 거부 오류가 반환되었습니다. 다만 시도 자체가 발생한 사실은 잠재적 침해 활동의 지표로 보존됩니다.` : "차단이 적용되지 않은 사후 탐지 사례이므로, 실제 변경 발생 여부를 베이스라인 비교를 통해 별도 확인하여야 합니다."}`,
      },
      {
        title: "8. 단기 대응 권고 (사건 발생 후 1시간 이내)",
        body: [
          "1. 동일 호스트에서 동일 시간대에 다른 보호 경로에 대한 시도가 다수 관찰되는지 확인합니다. 다수 관찰될 경우 호스트의 네트워크 격리를 우선 검토합니다.",
          "2. 사건 발생 시각의 호스트 프로세스 트리를 확보하고, 변경 시도 주체(UID, PID, 부모 프로세스, 실행 파일 해시)를 식별합니다.",
          ...profile.followupChecks.map((c, i) => `${i + 3}. ${c}`),
          `${profile.followupChecks.length + 3}. 본 호스트가 속한 OT 영역(Zone)의 인접 자산(PLC, HMI, Historian 등)에 대한 비정상 통신 또는 명령 호출 발생 여부를 OT 네트워크 모니터링 시스템에서 점검합니다.`,
        ].join("\n\n"),
      },
      {
        title: "9. 중장기 후속 조치 (사건 발생 후 24시간 이내)",
        body: "1. 정당한 변경으로 확정될 경우, 변경 관리 시스템에 사후 등록하고 보호 경로 베이스라인을 갱신합니다.\n\n2. 비정당 변경으로 판정될 경우 침해 사고 대응 절차(IR Playbook)를 발동합니다. 시스템 이미지 보존, 메모리 덤프, 외부 통신 추적, 침해 지표(IOC) 추출 등 표준 포렌식 절차를 수행합니다.\n\n3. 본 사건과 동일 분류의 자원이 OT 환경 내 다른 호스트에도 동일 베이스라인으로 보호되고 있는지 일관성을 점검하고, 누락 항목이 있을 경우 베이스라인 정책을 통합 갱신합니다.\n\n4. 가드 차단 이후에도 동일 시도가 반복될 경우 알람 임계값을 조정하고, 보안 운영 센터(SOC) 또는 OT 보안 관제 조직으로 정식 이관합니다.\n\n5. 본 사건을 ISA/IEC 62443 SR 6.2(연속 모니터링) 및 SR 7.6(네트워크 및 보안 구성 설정) 요건의 운영 증적으로 보존합니다.",
      },
      {
        title: "10. 참조 기준 및 주의 사항",
        body: "[관련 표준 및 가이드라인]\n• ISA/IEC 62443 — 산업 자동화 및 제어 시스템 사이버 보안\n• NIST SP 800-82 Rev.3 — 산업 제어 시스템(ICS) 보안 가이드\n• KISA 산업제어시스템 보안 가이드라인\n• MITRE ATT&CK for ICS — 산업 제어 시스템 대상 공격 기법 분류\n\n[보고서 생성 방식 및 한계]\n본 보고서는 LLM 기반 자동 생성 결과로, 보호 자원의 분류 정보·일반적 위협 인텔리전스·표준 대응 절차에 기반한 분석을 제공합니다. 실제 사건의 의도, 영향 범위, 침해 여부의 최종 판정은 본 보고서를 출발점으로 하여 호스트 컨텍스트 분석, 네트워크 트래픽 분석, 운영팀 협의 등을 통해 확정되어야 합니다.\n\n[보고서 신뢰성 향상 방안]\n동일 (자원 경로, 시도 유형) 조합에 대한 후속 사건은 캐시된 보고서를 재사용함으로써 일관성을 확보할 수 있습니다. 단, 호스트별 컨텍스트가 상이할 경우 보고서를 재생성하여 차이를 반영할 것을 권고합니다.",
      },
    ],
  };
  REPORT_STORE.set(event.id, report);
  return report;
}
