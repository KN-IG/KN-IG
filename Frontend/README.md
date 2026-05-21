# Frontend

KN-IG 콘솔(브라우저 + Tauri 데스크톱)의 UI 레이어. 데이터 흐름은 [`architecture.png`](architecture.png) 참고.

## 구성

```
public/    정적 자산(Tauri가 wrap): index.html(대시보드)·login.html(PIN)·config.js
  js/      api.js(REST+Bearer)·app.js(라우팅·5초 refresh)·ui.js·auth.js
desktop/   Tauri 2 데스크톱 셸
tailwind.* 스타일
```

## 빌드

사전: Node 18+, Rust toolchain, Xcode CLI tools(macOS).

| 작업 | 명령 |
|---|---|
| dev | `cd desktop && npm run tauri dev` |
| Tailwind watch | `npx tailwindcss -i tailwind.input.css -o public/assets/tailwind.css --watch` |
| 릴리스(.app/.dmg) | `cd desktop && npm run tauri build` |

산출물: `desktop/src-tauri/target/release/bundle/{macos/KN-IG Console.app, dmg/*.dmg}`.
Universal: `rustup target add x86_64-apple-darwin` 후 `npm run tauri build -- --target universal-apple-darwin`.

## 설정 — `public/config.js`

사이트별 단일 출처(UI 수정 불가, 빌드 직전 편집):

```js
window.IG_CONFIG = { backendUrl: "http://192.168.64.10:8080" };  // Mirror Server URL
```
빈 값/도달 실패 → `Connection error` + Retry. 고객별은 `customer/<name>` 브랜치에서 수정 후 빌드.

## 인증 & 데이터 흐름

상태 머신: `load → /auth/status → { setup | login | locked } → index.html`

| Mirror Server endpoint | 응답 |
|---|---|
| `GET /auth/status` | `{ state: unconfigured\|configured\|locked }` |
| `POST /auth/setup` | `{pin}` → `201 {token}` (최초 1회) |
| `POST /auth/login` | `{pin}` → `200 {token}` |

PIN 4–8자리 숫자(bcrypt), 10회 연속 실패 → 5분 잠금. 토큰은 `localStorage["ig.session.token"]` → `Authorization: Bearer`. 401/부재 시 login 리다이렉트.
대시보드는 5초마다 `/api/agents`·`/api/events?limit=200` fetch. Backend PascalCase → UI camelCase 정규화(`normalizeAgent`/`normalizeEvent`).

## 배포 추가 작업

코드 서명(Apple Developer ID) · 공증(`notarytool` → `stapler`) · 자동 업데이트([Tauri Updater](https://v2.tauri.app/plugin/updater/)) · 고객별 URL.
미서명 dmg 사내 배포 시: `xattr -d com.apple.quarantine "/Applications/KN-IG Console.app"`.
