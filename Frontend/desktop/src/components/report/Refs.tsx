// 08 / REFERENCES — 관측 MITRE 기법 + 적용 표준 + 용어 정의 + 방법론.
import type { ReportSummary } from "@/report/reportMockData";

export function Refs({ mitreGlossary }: { mitreGlossary: ReportSummary["mitreGlossary"] }) {
  return (
    <div className="card">
      <div className="ref-block">
        <h3>
          이 리포트에서 관측된 공격 기법 <span className="cnt">MITRE ATT&amp;CK {mitreGlossary.length}</span>
        </h3>
        <div className="mitre-list">
          {mitreGlossary.map((m, i) => (
            <div key={i} className="mitre-item">
              <div className="code">{m[0]}</div>
              <div className="mtext">
                <b>{m[1]}</b>
                <p>{m[2]}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="ref-block">
        <div className="two-col">
          <div>
            <h3>적용 표준</h3>
            <ul>
              <li><b>IEC 62443</b><span>산업 자동화·제어 시스템(IACS) 사이버 보안 국제 표준.</span></li>
              <li><b>NIST 800-82</b><span>산업 제어 시스템(ICS) 보안 가이드.</span></li>
              <li><b>MITRE ATT&amp;CK</b><span>공격 전술·기법 분류. ICS 매트릭스 우선.</span></li>
              <li><b>KISA</b><span>국내 산업제어시스템 보안 가이드라인.</span></li>
            </ul>
          </div>
          <div>
            <h3>용어 정의</h3>
            <ul>
              <li><b>무결성</b><span>파일이 허가 없이 변경되지 않은 원본 그대로의 상태.</span></li>
              <li><b>차단</b><span>변경 직전에 막아 실제 피해가 없는 상태.</span></li>
              <li><b>PID Chain</b><span>프로세스의 부모-자식 계보. 공격 시작 지점 추적.</span></li>
              <li><b>권한 상승</b><span>일반 권한(uid)에서 관리자(euid 0) 권한 획득.</span></li>
            </ul>
          </div>
        </div>
      </div>

      <div className="ref-block">
        <h3>방법론 및 데이터 신뢰도</h3>
        <p className="method">
          <b>분석 대상</b> 감시 호스트 3대(HMI-01·EWS-02·Historian-03), 기간 2026.05.14–05.21(168시간, 데이터 수집 완전성 100%). <b>집계 기준</b> 무결성 가드가 시스템 콜 단계에서 기록한 FILE_EVENT(차단·사후탐지). <b>제외</b> 정책 허용 변경·서명된 패키지 업데이트. <b>추정 표기</b> 공격 의도·시나리오는 관측 기반 추정이며 "~로 추정"으로 명시. 위험 등급은 자산 분류 규칙 + LLM 분석 결과로 산정되며 최종 판단은 보안 담당자가 수행합니다.
        </p>
      </div>
    </div>
  );
}
