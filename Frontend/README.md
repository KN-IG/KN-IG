# Frontend

KN-IG 관리자 콘솔(Tauri 2 데스크톱)의 UI 레이어. 데이터 흐름은 [`architecture.png`](../docs/architecture.png) 참고.

## 구성

```
desktop/      Tauri 2 데스크톱 셸 + Vite React SPA (현재 콘솔)
  src/        React+TS 소스 (Vite JIT Tailwind 포함)
  src-tauri/  Rust/Tauri 설정·명령
public/       구 Vanilla 앱 — 롤백 안전판으로 보존(현재 미사용)
```

## 빌드

사전: Node(LTS+), Rust toolchain. Mac은 Xcode CLT, Windows는 MSVC Build Tools.

| 작업 (`cd desktop`) | 명령 |
|---|---|
| 개발 실행 (Vite + Tauri) | `npm run dev` |
| 설치파일 빌드 (Vite + Tauri) | `npm run build` |

Tailwind는 Vite JIT 파이프라인이 처리합니다. 별도 watch 명령은 불필요합니다.

산출물 `desktop/src-tauri/target/release/bundle/`: Mac=`dmg/*.dmg`, Windows=`nsis/*-setup.exe`+`msi/*.msi`.
크로스 빌드 불가(각 OS에서 빌드). 자세한 빌드·배포는 [desktop/README.md](desktop/README.md).

## 설정 — `desktop/.env`

중앙 서버 주소는 빌드 시 박힙니다(단일 출처 `src/config.ts` → `VITE_BACKEND_URL`).
사이트가 다르면 `.env`를 바꿔 다시 빌드:

```
VITE_BACKEND_URL=http://192.168.64.10:8080   # Central Server URL
```
빈 값/도달 실패 → 연결 오류 화면. dev에서 백엔드 없이 UI만 보려면 `.env.development`의
`VITE_USE_MOCK=true`(release 빌드엔 미적용). 연결 절차는 [desktop/README.md](desktop/README.md).

## 인증 & 데이터 흐름

상태 머신: `load → /auth/status → { setup | login | locked } → index.html`

| Central Server endpoint | 응답 |
|---|---|
| `GET /auth/status` | `{ state: unconfigured\|configured\|locked }` |
| `POST /auth/setup` | `{pin}` → `201 {token}` (최초 1회) |
| `POST /auth/login` | `{pin}` → `200 {token}` |

PIN 4–8자리 숫자(bcrypt), 10회 연속 실패 → 5분 잠금. 토큰은 `localStorage["ig.session.token"]` → `Authorization: Bearer`. 401/부재 시 login 리다이렉트.
대시보드는 5초마다 `/api/agents`·`/api/events?limit=200` fetch. Backend PascalCase → UI camelCase 정규화(`normalizeAgent`/`normalizeEvent`).

## 배포 추가 작업

코드 서명(Apple Developer ID) · 공증(`notarytool` → `stapler`) · 자동 업데이트([Tauri Updater](https://v2.tauri.app/plugin/updater/)) · 고객별 URL.
미서명 dmg 사내 배포 시: `xattr -d com.apple.quarantine "/Applications/KN-IG Console.app"`.
