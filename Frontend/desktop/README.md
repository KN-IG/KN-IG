# KN-IG Console — 데스크톱 (Tauri 2)

관리자 콘솔 GUI. UI 자산은 `../public`(정적), 셸은 Tauri 2.
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

1. `../public/config.js` 의 `backendUrl` 을 그 현장 중앙서버 주소로 설정 (**빌드 시 앱에 박힘**)
2. `npm run build`
3. 나온 `.dmg` / `.exe` 를 사용자에게 전달 → 설치
4. **업데이트**: 코드 수정 → `npm run build` → 새 파일을 다시 전달(재설치)

## 첫 실행 보안 경고 (미서명)

- **macOS**: 우클릭 → 열기, 또는 `xattr -d com.apple.quarantine "/Applications/KN-IG Console.app"`
- **Windows**: SmartScreen → "추가 정보" → "실행"

## 사이트별 설정

`backendUrl` 은 빌드에 박히므로, 현장(중앙서버)마다 다르면 `config.js` 를 바꿔 **그 현장용으로 다시 빌드**합니다.
현장이 하나면 한 번 맞춰두고 그 빌드를 계속 쓰면 됩니다.

## 향후 (선택)
- 코드 서명·공증 → 보안 경고 제거
- 자동 업데이트(Tauri Updater) → 앱 자가 갱신(파일 재전달 불필요)
