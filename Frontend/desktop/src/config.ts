// 빌드타임 주입 구성. Vite `import.meta.env`로 빌드 시 값이 박힌다.
//   backendUrl  Central Server HTTP URL (예: http://192.168.64.10:8080)
//               빌드의 절대 출처 — 빈 값이거나 도달 실패 시 콘솔이 connection-error 화면을 표시.
export const config = {
  backendUrl: import.meta.env.VITE_BACKEND_URL ?? "",
  // 백엔드 없이 UI를 테스트하기 위한 mock 모드. `.env.development`의 VITE_USE_MOCK=true로 켜며
  // dev(vite/tauri dev) 전용 — release 빌드(.env)는 false라 실서버에 연결한다.
  useMock: import.meta.env.VITE_USE_MOCK === "true",
} as const;
