// Central Server API 클라이언트.
//   - Bearer 토큰 자동 첨부(localStorage 'ig.session.token').
//   - 401 응답 시: 활성 폴링/in-flight 요청 정지 → 토큰 삭제 → /login 리다이렉트.
//
// 원본 이식: Frontend/public/js/api.js:13-29.
// 차이점: HashRouter 환경이므로 location.replace 대신 주입된 navigate 콜백을 호출한다
// (페이지 전체 재로딩 방지). App에서 setUnauthorizedHandler로 핸들러를 등록한다.

import { config } from "../config";
import { cancelAll, registerController } from "./lifecycle";

export const TOKEN_KEY = "ig.session.token";

// URL은 빌드 시 박힌 config.backendUrl이 유일한 출처.
function getBackendURL(): string {
  return (config.backendUrl || "").replace(/\/+$/, "");
}

// 401 발생 시 호출할 핸들러. App이 react-router navigate로 교체한다.
// 기본값은 no-op(핸들러 미등록 시 무한 리다이렉트·예외 방지).
let onUnauthorized: () => void = () => {};

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

// 401 공통 처리: 폴링 정지 + 토큰 삭제 + 리다이렉트.
function handleUnauthorized(): void {
  cancelAll();
  localStorage.removeItem(TOKEN_KEY);
  onUnauthorized();
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

// 인증된 API 요청. signal 미지정 시 내부 AbortController를 만들어
// lifecycle 레지스트리에 등록 → 401/로그아웃 시 함께 취소된다.
export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const base = getBackendURL();
  if (!base) throw new Error("backend URL not set");

  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // 호출자가 signal을 주면 그대로 쓰고, 아니면 등록형 컨트롤러를 생성한다.
  let unregister: (() => void) | undefined;
  let signal = opts.signal ?? undefined;
  if (!signal) {
    const controller = new AbortController();
    unregister = registerController(controller);
    signal = controller.signal;
  }

  try {
    const res = await fetch(base + path, { ...opts, headers, signal });
    if (res.status === 401) {
      handleUnauthorized();
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return res;
  } finally {
    unregister?.();
  }
}
