"""Deterministic path classification.

Maps a protected file path to its asset category, severity and the MITRE
techniques most associated with tampering it. This is the *grounding* layer:
it gives the LLM (and the template fallback) a factual basis so severities and
technique mappings are never invented.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Tuple


@dataclass
class Profile:
    category: str
    severity: str  # Critical | High | Medium | Low
    mitre: List[str]  # technique ids (may be sub-techniques, e.g. T1003.008)
    role: str
    scenarios: List[str] = field(default_factory=list)
    followups: List[str] = field(default_factory=list)
    match: Callable[[str], bool] = field(default=lambda p: False)


def _profiles() -> List[Profile]:
    return [
        Profile(
            match=lambda p: p in ("/etc/shadow", "/etc/gshadow"),
            category="사용자 자격 증명 저장소",
            severity="Critical",
            mitre=["T1003.008", "T1098"],
            role="시스템에 등록된 모든 사용자의 암호화된 비밀번호 정보를 저장하는 자원입니다. 무결성이 손상되면 임의 계정의 비밀번호가 재설정되거나 인증 우회 백도어가 형성될 수 있습니다.",
            scenarios=[
                "초기 침투에 성공한 위협 주체가 운영 계정 비밀번호를 자신이 아는 값으로 재설정해 영구 접근 경로를 확보하려는 시도입니다.",
                "비밀번호 해시 필드를 비활성 값으로 대체해 비밀번호 없이 인증이 통과되도록 만드는 변조 시도입니다.",
            ],
            followups=[
                "사건 시각 전후의 인증 로그(/var/log/auth.log, secure)에서 비정상 SSH 로그인·권한 상승을 확인합니다.",
                "정상 자격 증명 도구(passwd 등) 외의 프로세스가 본 파일에 쓰기를 시도했는지 감사 로그로 점검합니다.",
            ],
        ),
        Profile(
            match=lambda p: p in ("/etc/passwd", "/etc/group"),
            category="사용자 계정 데이터베이스",
            severity="Critical",
            mitre=["T1136.001", "T1098"],
            role="시스템에 등록된 사용자 및 그룹 정보를 보관하는 자원으로, 변조 시 신규 관리자 권한 계정 추가나 기존 계정 권한 변경이 발생할 수 있습니다.",
            scenarios=[
                "UID 0(관리자) 신규 계정을 추가해 백도어 형태의 영구 접근 경로를 확보하려는 시도입니다.",
                "기존 시스템 계정의 로그인 셸을 인터랙티브 셸로 바꿔 침투 통로로 전환하려는 시도입니다.",
            ],
            followups=[
                "현재 UID 0 계정 목록과 알려진 관리자 명단을 대조해 비정상 항목을 확인합니다.",
                "최근 24시간 계정 추가·변경 명령 이력과 본 사건 시각을 대조합니다.",
            ],
        ),
        Profile(
            match=lambda p: p == "/etc/sudoers" or p.startswith("/etc/sudoers.d/") or p == "/usr/bin/sudo",
            category="권한 상승 정책 및 도구",
            severity="Critical",
            mitre=["T1548.003", "T1554"],
            role="일반 사용자에게 일시적 관리자 권한을 부여하는 정책 파일 또는 도구로, 변조 시 무인증 권한 상승 통로나 자격 증명 탈취 백도어가 형성될 수 있습니다.",
            scenarios=[
                "특정 사용자에 무비밀번호 관리자 권한 항목을 삽입해 권한 상승 인증 절차를 무력화하려는 시도입니다.",
                "권한 상승 도구 자체에 트로이 목마를 삽입해 사용할 때마다 자격 증명이 유출되도록 만드는 시도입니다.",
            ],
            followups=[
                "현재 적용 중인 권한 정책을 출력해 운영 표준과 차이를 점검하고, 권한 도구 패키지 무결성을 검증합니다.",
                "사건 시각 전후의 권한 상승 호출 이력과 사용자별 권한 변경 기록을 인증 로그에서 확인합니다.",
            ],
        ),
        Profile(
            match=lambda p: p == "/etc/ssh/sshd_config" or p.startswith("/etc/ssh/"),
            category="원격 접근 제어 정책",
            severity="Critical",
            mitre=["T1098.004", "T1556"],
            role="외부 호스트에서 원격 접속할 때 적용되는 인증·접근 제어 정책을 정의하는 자원입니다. 변조 시 관리자 직접 로그인 허용, 비인가 키 추가 등 원격 접근 정책 전반이 무력화될 수 있습니다.",
            scenarios=[
                "관리자 계정의 직접 원격 로그인을 재허용해 무차별 추측 공격에 노출시키는 정책 변경 시도입니다.",
                "공격자가 통제하는 인증 키를 등록해 발각 이후에도 재침투 가능한 영구 통로를 확보하려는 시도입니다.",
            ],
            followups=[
                "현재 SSH 데몬 설정을 덤프해 운영 표준(골든 이미지)과 차이를 비교합니다.",
                "관리자·일반 사용자 인증 키 파일에 신규 항목이 추가됐는지 점검합니다.",
            ],
        ),
        Profile(
            match=lambda p: p == "/etc/crontab" or p.startswith("/etc/cron.") or p.startswith("/var/spool/cron/"),
            category="스케줄러 / 자동 실행 영속성 메커니즘",
            severity="High",
            mitre=["T1053.003"],
            role="주기적으로 자동 실행될 작업을 정의하는 파일입니다. 변조 시 공격자 페이로드가 재기동·프로세스 종료 후에도 자동 복구되어 영구 침입 통로가 유지될 수 있습니다.",
            scenarios=[
                "단주기로 외부 C2 서버에 콜백하는 항목을 삽입해 단발 차단 후에도 즉시 재접속하는 통로를 확보하려는 시도입니다.",
                "@reboot 지시자로 부팅 시 실행되는 백도어를 등록하려는 시도입니다.",
            ],
            followups=[
                "사용자·시스템 예약 작업 디렉터리 전 영역 스냅샷을 비교해 비인가 항목을 확인합니다.",
                "사건 직후 자동 실행된 자식 프로세스 트리를 추적해 외부 통신·인터프리터 호출 여부를 확인합니다.",
            ],
        ),
        Profile(
            match=lambda p: bool(re.search(r"\.(env|secret|key|pem|crt)$", p)) or bool(re.search(r"/secrets?/", p)) or bool(re.search(r"/credentials?/", p)),
            category="비밀 정보 저장 파일",
            severity="High",
            mitre=["T1552.001", "T1485"],
            role="DB 자격 증명, API 키, TLS 인증서 등 민감 정보를 보관하는 자원입니다. 변조 시 정상 연동이 공격자 인프라로 우회되거나, 삭제 시 서비스 중단·흔적 인멸의 신호일 수 있습니다.",
            scenarios=[
                "DB 접속 정보를 공격자 통제 인스턴스로 변조해 중간자 공격 또는 자격 증명 수집 통로를 형성하려는 시도입니다.",
                "외부 API 키를 유출한 뒤 흔적 제거 목적으로 파일을 삭제하려는 시도입니다.",
            ],
            followups=[
                "최근 배포·CI/CD 실행 로그와 사건 시각을 대조해 정상 갱신 여부를 식별합니다.",
                "유출 가능성을 가정하고 해당 자격 증명을 즉시 회전(rotation)합니다.",
            ],
        ),
        Profile(
            match=lambda p: p.startswith("/var/log/"),
            category="감사 로그",
            severity="High",
            mitre=["T1070.002", "T1070.004"],
            role="시스템·애플리케이션 활동의 감사 추적 데이터를 보관하는 파일입니다. 삭제·변조는 일반적으로 흔적 인멸 활동의 강력한 지표로 해석됩니다.",
            scenarios=[
                "이미 침투한 위협 주체가 자신의 활동 흔적을 제거해 탐지를 지연시키려는 시도입니다.",
                "랜섬웨어 작동 직전 단계로 백업·감사 로그를 사전 무력화하는 패턴일 가능성이 있습니다.",
            ],
            followups=[
                "원격 로그 수집 인프라(SIEM, 중앙 syslog)에 동일 기간 로그가 보존돼 있는지 확인합니다.",
                "삭제 직전·직후의 다른 호스트 활동 로그와 네트워크 트래픽을 상관 분석합니다.",
            ],
        ),
        Profile(
            match=lambda p: p.startswith("/usr/lib/") or p.startswith("/lib/") or p.startswith("/lib64/"),
            category="시스템 핵심 라이브러리",
            severity="Critical",
            mitre=["T1574.006", "T1554"],
            role="다수 시스템 프로그램이 공통으로 사용하는 동적 링크 라이브러리입니다. 변조 시 해당 라이브러리를 사용하는 모든 호출자에게 페이로드가 동시 주입되는 광범위 영향이 발생합니다.",
            scenarios=[
                "암호화 라이브러리에 백도어를 삽입해 TLS 트래픽 가로채기 또는 키 자료 유출을 시도합니다.",
                "사용자 공간 후킹 루트킷을 설치해 운영 도구 출력에서 공격자 활동을 은폐합니다.",
            ],
            followups=[
                "패키지 매니저(rpm -V, dpkg -V)로 라이브러리 무결성을 검증합니다.",
                "본 라이브러리를 사용하는 프로세스 메모리 매핑에 LD_PRELOAD·코드 주입 흔적이 있는지 점검합니다.",
            ],
        ),
        Profile(
            match=lambda p: p.startswith("/usr/bin/") or p.startswith("/usr/sbin/") or p.startswith("/bin/") or p.startswith("/sbin/"),
            category="운영체제 표준 실행 파일",
            severity="High",
            mitre=["T1554", "T1036.005"],
            role="운영체제가 기본 제공하는 표준 명령어 파일입니다. 변조 시 해당 명령어를 사용하는 모든 호출자가 영향받는 호스트 내 공급망 침해가 발생할 수 있습니다.",
            scenarios=[
                "프로세스·네트워크 조회 도구를 변조해 공격자 프로세스·연결을 결과에서 제외하는 사용자 공간 루트킷 패턴입니다.",
                "표준 설치 절차를 경유하지 않은 직접 교체로 패키지 무결성 검증을 우회하려는 시도입니다.",
            ],
            followups=[
                "패키지 매니저 무결성 검증으로 변조 여부를 확인하고, 변조본 해시를 벤더 공식 해시와 비교합니다.",
                "최근 패키지 설치·업그레이드 이력을 사건 시각과 대조합니다.",
            ],
        ),
        Profile(
            match=lambda p: p.startswith("/usr/local/bin/") or p.startswith("/usr/local/sbin/") or (p.startswith("/opt/") and "/bin/" in p),
            category="관리자 설치 운영 도구",
            severity="High",
            mitre=["T1554"],
            role="관리자가 표준 패키지 외로 직접 배치한 운영 도구입니다. 변조 시 운영자가 일상적으로 사용하는 도구가 위협 주체 통제 하에 놓입니다.",
            scenarios=[
                "운영자가 빈번히 호출하는 도구를 변조해 호출 시마다 자격 증명·세션 정보를 외부로 유출시키려는 시도입니다.",
                "정상 배포 절차 외의 직접 교체로 변경 관리 절차를 우회하려는 신호로 해석됩니다.",
            ],
            followups=[
                "원본 배포 산출물·설치 스크립트와 해시 비교로 변조 여부를 확인합니다.",
                "본 도구를 자주 호출하는 사용자 계정의 셸 명령 이력을 점검합니다.",
            ],
        ),
        Profile(
            match=lambda p: p.startswith("/etc/nginx/") or p.startswith("/etc/httpd/") or p.startswith("/etc/apache2/"),
            category="웹 서버 설정",
            severity="High",
            mitre=["T1556", "T1071.001"],
            role="리버스 프록시, 가상 호스트, TLS 인증 등 웹 트래픽 라우팅·접근 제어 정책을 정의하는 설정입니다. 변조 시 트래픽 우회, 인증 우회, 감사 로그 비활성화가 가능해집니다.",
            scenarios=[
                "관리 엔드포인트의 IP 화이트리스트 제한을 해제해 외부 직접 접근을 허용하려는 시도입니다.",
                "접근·오류 로그 기록을 비활성화해 흔적을 최소화하려는 변조 시도입니다.",
            ],
            followups=[
                "현재 웹 서버 설정을 출력해 IaC 원본 설정과 차이를 비교합니다.",
                "변경 직후 외부 DNS 조회·신규 server_name 매칭 트래픽 발생 여부를 점검합니다.",
            ],
        ),
        Profile(
            match=lambda p: p == "/etc/resolv.conf" or p == "/etc/hosts" or p == "/etc/nsswitch.conf",
            category="네트워크 이름 해석 설정",
            severity="High",
            mitre=["T1565.001", "T1071.004"],
            role="DNS 서버, 정적 호스트 매핑, 이름 해석 우선순위를 정의하는 파일입니다. 변조 시 시스템의 모든 외부 호출이 공격자 통제 인프라로 우회될 수 있습니다.",
            scenarios=[
                "DNS 서버를 공격자 리졸버로 변경해 라이브러리·패키지 미러 응답을 위조하는 시도입니다.",
                "/etc/hosts에 정상 도메인을 공격자 IP로 매핑해 보안 검증을 우회하려는 시도입니다.",
            ],
            followups=[
                "DHCP·cloud-init 로그와 사건 시각을 대조하고 클라우드 메타데이터 변경 이력을 확인합니다.",
                "변경 이후 해석된 외부 도메인 응답을 신뢰 리졸버로 재확인해 위조 여부를 검증합니다.",
            ],
        ),
        Profile(
            match=lambda p: p.startswith("/etc/myapp/") or (p.startswith("/etc/") and bool(re.search(r"\.(yaml|yml|conf|toml|ini|json)$", p))),
            category="애플리케이션 / 시스템 구성 파일",
            severity="High",
            mitre=["T1565.001"],
            role="서비스 동작을 결정하는 구성 파일입니다. 변조 시 보안 정책 비활성화, 외부 엔드포인트 변경, 기능 플래그 토글 등 광범위한 영향이 발생할 수 있습니다.",
            scenarios=[
                "보안 옵션(TLS 검증, 인증 미들웨어)을 비활성화하려는 시도입니다.",
                "외부 호출 엔드포인트를 공격자 인프라로 교체해 트래픽 가로채기를 시도하는 변조입니다.",
            ],
            followups=[
                "형상 관리 저장소의 동일 파일과 차이를 비교하고 변경 요청(PR/티켓) 존재 여부를 확인합니다.",
                "구성 변경 직후 인증 실패율·외부 호출량 변동을 점검합니다.",
            ],
        ),
        Profile(
            match=lambda p: p.startswith("/var/www/") or p.startswith("/usr/share/nginx/html/"),
            category="웹 콘텐츠",
            severity="Medium",
            mitre=["T1491.001", "T1189"],
            role="공개 웹 서버가 서빙하는 정적 콘텐츠입니다. 변조 시 디페이스 또는 악성 스크립트 삽입을 통한 방문자 공격이 가능해집니다.",
            scenarios=[
                "JavaScript 삽입을 통한 방문자 대상 자격 증명 피싱·페이로드 배포 시도입니다.",
                "콘텐츠 관리 시스템을 통한 정상 콘텐츠 갱신일 가능성도 존재합니다.",
            ],
            followups=[
                "변경된 파일 내 외부 스크립트 src·비정상 태그 존재 여부를 검사합니다.",
                "웹 서버 접근 로그에서 변경 직전 PUT/POST·업로드 호출 이력을 추적합니다.",
            ],
        ),
        Profile(
            match=lambda p: p.startswith("/tmp/") or p.startswith("/var/tmp/") or p.startswith("/dev/shm/"),
            category="임시 작업 영역",
            severity="Medium",
            mitre=["T1074.001", "T1059.004"],
            role="재기동 시 휘발되는 임시 디렉터리입니다. 정상 사용도 많지만 숨김 파일·실행 권한 스크립트는 위협 주체 페이로드 stage 위치로 빈번히 활용됩니다.",
            scenarios=[
                "위협 주체가 도구·페이로드 사용 후 흔적 제거를 위해 임시 파일을 삭제한 시도입니다.",
                "정상 빌드·캐시 파일이 정리된 운영 작업일 가능성도 존재합니다.",
            ],
            followups=[
                "삭제 직전 파일 메타 정보(소유자·실행 권한·생성 시각)가 백업돼 있는지 확인합니다.",
                "보안 솔루션 격리 이력과 사건 시각을 대조해 자동 차단 결과인지 식별합니다.",
            ],
        ),
    ]


PROFILES = _profiles()

DEFAULT_PROFILE = Profile(
    match=lambda p: True,
    category="기타 보호 경로",
    severity="Medium",
    mitre=["T1565"],
    role="보호 대상으로 등록된 경로이며, 호스트의 운영 역할에 따라 무결성 손상 시 영향이 다양하게 나타날 수 있습니다.",
    scenarios=[
        "정상 운영 변경이 변경 관리 절차 외 경로로 수행된 경우입니다.",
        "위협 주체가 보호 경로 목록을 사전 인지하지 못한 채 시도한 경우입니다.",
    ],
    followups=[
        "본 자원을 사용하는 부서·담당자에게 정당한 변경 여부를 확인합니다.",
        "본 경로가 보호 대상으로 등록된 시점·근거를 검토합니다.",
    ],
)


def classify(path: str) -> Profile:
    for p in PROFILES:
        try:
            if p.match(path):
                return p
        except Exception:
            continue
    return DEFAULT_PROFILE


# ──────────────────────── MITRE knowledge tables ────────────────────────

# id -> (korean title, plain-language description)
MITRE_GLOSSARY: Dict[str, Tuple[str, str]] = {
    "T1003": ("자격증명 추출", "시스템에 저장된 로그인 자격증명을 비인가 경로로 획득하려는 행위입니다."),
    "T1003.008": ("OS 자격증명 추출 (/etc/passwd & /etc/shadow)", "시스템에 저장된 로그인 자격증명을 비인가 경로로 획득하려는 행위입니다."),
    "T1036": ("정상 위치·이름 위장", "정상 명령어와 같은 이름·위치를 사용해 악성 프로그램을 위장하는 행위입니다."),
    "T1036.005": ("정상 위치·이름 위장", "정상 명령어와 같은 이름·위치를 사용해 악성 프로그램을 위장하는 행위입니다."),
    "T1053": ("예약 작업 (cron)", "cron에 작업을 심어 주기적 실행과 지속성을 확보합니다."),
    "T1053.003": ("예약 작업 (cron)", "cron에 작업을 심어 주기적 실행과 지속성을 확보합니다."),
    "T1059": ("명령·스크립트 실행", "셸·인터프리터로 임의 명령을 실행하는 행위입니다."),
    "T1059.004": ("유닉스 셸 명령 실행", "유닉스 셸을 통해 임의 명령을 실행하는 행위입니다."),
    "T1068": ("취약점 악용 권한 상승", "소프트웨어 취약점을 악용해 더 높은 권한을 획득하는 행위입니다."),
    "T1070": ("흔적 삭제", "시스템·감사 로그를 삭제해 공격 흔적을 제거하고 탐지를 회피합니다."),
    "T1070.002": ("로그 삭제", "시스템·감사 로그를 삭제해 공격 흔적을 제거하고 탐지를 회피합니다."),
    "T1070.004": ("파일 삭제", "침해 증거가 될 수 있는 파일을 삭제하는 행위입니다."),
    "T1071": ("응용 계층 프로토콜 악용", "정상 통신을 가장해 공격자 인프라와 정보를 주고받는 행위입니다."),
    "T1071.001": ("웹 프로토콜 악용 통신", "정상 웹 통신을 가장해 공격자 인프라와 정보를 주고받는 행위입니다."),
    "T1071.004": ("DNS 통신 악용", "도메인 이름 해석 통신을 이용해 공격자 인프라와 정보를 주고받는 행위입니다."),
    "T1078": ("유효 계정", "탈취한 정상 계정으로 접근·지속·권한 상승을 수행하는 행위입니다."),
    "T1098": ("계정 조작", "기존 계정의 인증 정보·권한을 임의로 변경해 지속적 접근 통로를 확보합니다."),
    "T1098.004": ("SSH 인증 키 추가", "공격자 인증 키를 등록해 영구적 원격 접근 통로를 확보하는 행위입니다."),
    "T1136": ("계정 생성", "공격자만 사용 가능한 신규 계정을 시스템에 추가하는 행위입니다."),
    "T1136.001": ("로컬 계정 생성", "공격자만 사용 가능한 로컬 계정을 추가하는 행위입니다."),
    "T1485": ("데이터 파괴", "중요 파일을 삭제해 서비스 중단·흔적 제거를 유도하는 행위입니다."),
    "T1491": ("디페이스", "표시 콘텐츠를 변조해 메시지를 표시하거나 신뢰를 훼손하는 행위입니다."),
    "T1491.001": ("내부 디페이스", "내부 시스템에 표시되는 콘텐츠를 변조하는 행위입니다."),
    "T1189": ("방문자 대상 침해", "변조된 웹페이지를 통해 방문자 시스템에 악성 코드를 배포하려는 행위입니다."),
    "T1543": ("systemd 서비스", "정상 서비스로 위장한 서비스를 등록해 재부팅 후에도 지속성을 확보합니다."),
    "T1543.002": ("systemd 서비스 생성/변조", "정상 서비스로 위장한 서비스를 등록해 재부팅 후에도 지속성을 확보합니다."),
    "T1548": ("권한 상승 메커니즘 악용", "권한 부여 메커니즘(sudo 등)을 악용해 권한을 획득하는 행위입니다."),
    "T1548.003": ("Sudo 및 Sudo 캐싱 악용", "sudo 권한 정책을 악용해 일반 계정이 관리자 권한을 획득합니다."),
    "T1552": ("비보호 자격 증명", "파일·환경 등에 저장된 자격 증명을 비인가 경로로 획득하는 행위입니다."),
    "T1552.001": ("파일 내 자격 증명 노출", "비밀번호·인증 키가 저장된 파일을 비인가 경로로 획득하는 행위입니다."),
    "T1554": ("신뢰 프로그램 변조", "신뢰받는 시스템 프로그램에 악성 코드를 삽입하는 행위입니다."),
    "T1556": ("인증 절차 변조", "로그인 검증 과정 자체를 조작해 정상 인증을 우회합니다."),
    "T1565": ("데이터 조작", "시스템에 저장된 데이터를 임의로 변경해 동작을 왜곡하는 행위입니다."),
    "T1565.001": ("저장 데이터 조작", "디스크에 저장된 설정·데이터를 임의로 변경해 시스템 동작을 왜곡하는 행위입니다."),
    "T1574": ("실행 흐름 가로채기", "정상 실행 흐름에 개입해 공격자 코드가 실행되도록 만드는 행위입니다."),
    "T1574.006": ("LD_PRELOAD를 통한 실행 흐름 가로채기", "정상 라이브러리를 우선 로드시켜 모든 호출에 공격자 코드가 개입하게 만드는 행위입니다."),
}

# Fixed kill-chain phases (order matches the console report's killPhases).
KILL_PHASES = ["초기 접근", "권한 상승", "자격증명 접근", "방어 회피", "영향"]

# base technique id -> (tactic_ko, tactic_en, kill-phase index)
_TECH_TACTIC: Dict[str, Tuple[str, str, int]] = {
    "T1078": ("초기 접근", "Initial Access", 0),
    "T1189": ("초기 접근", "Initial Access", 0),
    "T1003": ("자격증명 접근", "Credential Access", 2),
    "T1552": ("자격증명 접근", "Credential Access", 2),
    "T1548": ("권한 상승", "Privilege Esc.", 1),
    "T1068": ("권한 상승", "Privilege Esc.", 1),
    "T1098": ("지속성", "Persistence", 1),
    "T1136": ("지속성", "Persistence", 1),
    "T1543": ("지속성", "Persistence", 1),
    "T1053": ("지속성", "Persistence", 1),
    "T1554": ("지속성", "Persistence", 1),
    "T1556": ("방어 회피", "Defense Evasion", 3),
    "T1070": ("방어 회피", "Defense Evasion", 3),
    "T1036": ("방어 회피", "Defense Evasion", 3),
    "T1574": ("방어 회피", "Defense Evasion", 3),
    "T1071": ("방어 회피", "Defense Evasion", 3),
    "T1074": ("방어 회피", "Defense Evasion", 3),
    "T1059": ("방어 회피", "Defense Evasion", 3),
    "T1565": ("영향", "Impact", 4),
    "T1485": ("영향", "Impact", 4),
    "T1491": ("영향", "Impact", 4),
}

# Tactic column order for the ATT&CK matrix.
TACTIC_ORDER = [
    ("초기 접근", "Initial Access"),
    ("자격증명 접근", "Credential Access"),
    ("권한 상승", "Privilege Esc."),
    ("지속성", "Persistence"),
    ("방어 회피", "Defense Evasion"),
    ("영향", "Impact"),
]


def base_id(tech: str) -> str:
    """T1003.008 -> T1003"""
    return tech.split(".")[0]


def tech_name(tech: str) -> str:
    title = MITRE_GLOSSARY.get(tech) or MITRE_GLOSSARY.get(base_id(tech))
    return title[0] if title else tech


def tactic_of(tech: str) -> Tuple[str, str, int]:
    return _TECH_TACTIC.get(base_id(tech), ("방어 회피", "Defense Evasion", 3))
