# KN-IG Console — 데스크톱 (Tauri 2)

관리자 콘솔 GUI. UI는 Vite+React+TS로 빌드(`dist/`), 셸은 Tauri 2.
설치파일을 **로컬에서 원할 때 빌드**해 사용자에게 **직접 전달**합니다.

## 빌드 (Mac · Windows 동일)

```bash
cd Frontend/desktop
npm install        # 최초 1회
npm run build      # 현재 OS용 설치파일 빌드   (개발 실행: npm run dev)
```

산출물 `src-tauri/target/release/bundle/`:
- **Mac에서 빌드** → `dmg/KN-IG Console_<v>_*.dmg`
- **Windows에서 빌드** → `nsis/*-setup.exe`, `msi/*.msi`  ← 사용자에겐 `.exe` 전달

> 크로스 빌드 불가 — **Windows 파일은 Windows에서, Mac 파일은 Mac에서** 빌드.
> 버전은 `src-tauri/tauri.conf.json` 의 `"version"` 을 바꾸면 파일명에 반영됩니다.

### 준비물 (1회)
- 공통: **Node**(LTS+), **Rust**(rustup)
- **Windows**: Rust 설치 시 **Microsoft C++ Build Tools(MSVC)** 필요(rustup이 안내). NSIS·WiX는 빌드 중 Tauri가 자동 설치.
- **Mac**: Xcode CLT (`xcode-select --install`)

## 배포 / 업데이트 (파일 직접 전달)

1. `.env` 의 `VITE_BACKEND_URL` 을 그 현장 중앙서버 주소로 설정 (**빌드 시 앱에 박힘**)
   ```
   VITE_BACKEND_URL=http://<중앙서버IP>:8080
   ```
2. `npm run build`
3. 나온 `.dmg` / `.exe` 를 사용자에게 전달 → 설치
4. **업데이트**: 코드 수정 → `npm run build` → 새 파일을 다시 전달(재설치)

> 구성 출처는 `src/config.ts` → `import.meta.env.VITE_BACKEND_URL`(`.env`) 한 곳입니다.
> (과거 `public/config.js` 방식은 React 재구축으로 폐기됨 — 이 콘솔은 사용하지 않습니다.)

## 중앙 서버 연결 (Backend · LLM · Agent)

Dashboard·Report는 중앙 서버 REST API(`:8080`)에서 실데이터를 받습니다.
연결 경로는 `agents/events/alerts`(Dashboard) · `reports/summary`→LLM(Report)이며,
모두 콘솔 PIN 인증(Bearer) 뒤에 있습니다.

**1) 서버·에이전트 기동** — 각 VM에서 (루트 `kn-ig` CLI):
```bash
sudo ./kn-ig --server            # 중앙(Backend+MySQL)  :8080 콘솔 · :9000 mTLS
sudo ./kn-ig --llm               # LLM(FastAPI)         :8088
sudo ./kn-ig --agent <중앙IP>     # Agent (인증서 물리 삽입 후)  → 중앙 :9000
./kn-ig --verify --event-test    # 전 구간 검증(FAIL=0 + 이벤트 흐름)
```
> Agent는 **Linux 전용**(eBPF/LKM). macOS에선 transport가 비활성이라 이벤트를 보내지 않습니다.
> 인증서는 `--server`가 `Backend/certs/`에 생성 → USB 등으로 각 Agent `Agent/certs/`에 배치.

**2) 콘솔을 그 서버로** — `.env`(빌드용) 또는 dev 실연동:
```bash
# 실서버로 빌드: .env 의 VITE_BACKEND_URL 을 중앙IP로 → npm run build
# 또는 dev에서 실서버 테스트: .env.development 에서 mock 끄기
VITE_USE_MOCK=false
VITE_BACKEND_URL=http://<중앙서버IP>:8080
```

**3) 첫 실행 = PIN 설정** — 백엔드에 PIN이 없으면 로그인 화면이 **설정(setup)** 으로 뜹니다.
PIN을 정하면 이후 같은 PIN으로 로그인합니다.

**4) 연결 확인**
- Dashboard: 에이전트 수/상태·오늘 이벤트·열린 알림이 실데이터로 표시(5초 폴링).
- Report: 기간을 바꾸면 `POST /api/reports/summary` 재요청. 서버/LLM 실패 시 HERO에
  **"임시 데이터(서버 미연결)"** 칩이 뜨고 mock으로 폴백합니다(콘솔 콘솔로그에 사유).

## 첫 실행 보안 경고 (미서명)

- **macOS**: 우클릭 → 열기, 또는 `xattr -d com.apple.quarantine "/Applications/KN-IG Console.app"`
- **Windows**: SmartScreen → "추가 정보" → "실행"

## 사이트별 설정

`VITE_BACKEND_URL` 은 빌드에 박히므로, 현장(중앙서버)마다 다르면 `.env` 를 바꿔 **그 현장용으로 다시 빌드**합니다.
현장이 하나면 한 번 맞춰두고 그 빌드를 계속 쓰면 됩니다.

## 향후 (선택)
- 코드 서명·공증 → 보안 경고 제거
- 자동 업데이트(Tauri Updater) → 앱 자가 갱신(파일 재전달 불필요)
