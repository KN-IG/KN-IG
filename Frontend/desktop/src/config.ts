// 빌드타임 주입 구성. Vite `import.meta.env`로 빌드 시 값이 박힌다.
//   backendUrl  Central Server HTTP URL (예: http://192.168.64.10:8080)
//               빌드의 절대 출처 — 빈 값이거나 도달 실패 시 콘솔이 connection-error 화면을 표시.
export const config = {
  backendUrl: import.meta.env.VITE_BACKEND_URL ?? "",
} as const;
