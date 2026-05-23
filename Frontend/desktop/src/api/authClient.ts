// 인증 엔드포인트 클라이언트.
//   GET  /auth/status  → { state: 'unconfigured' | 'configured' | 'locked' }
//   POST /auth/setup   body { pin } → 201 { token }
//   POST /auth/login   body { pin } → 200 { token }
//
// 인증 요청은 토큰이 없는 상태에서도 호출되므로 client.ts의 apiFetch(Bearer/401)와
// 분리한다. Central Server URL은 빌드 시 박힌 config.backendUrl이 절대 출처.
// config.useMock(dev)일 때는 백엔드 없이 통과시켜 UI를 테스트한다(아무 4~8자리 PIN 허용).

import { config } from "../config";

export type AuthState = "unconfigured" | "configured" | "locked";

export interface AuthStatusResponse {
  state: AuthState;
}

export interface AuthTokenResponse {
  token: string;
}

// 로그인/셋업 실패를 분류하기 위한 에러 코드.
export type AuthErrorCode = "invalid_pin" | "locked";

export class AuthError extends Error {
  status?: number;
  code?: AuthErrorCode;
  constructor(message: string, status?: number, code?: AuthErrorCode) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

const MOCK_TOKEN = "mock-session-token";

function getBackendURL(): string {
  return (config.backendUrl || "").replace(/\/+$/, "");
}

// 도달 불가 서버에서 무한 대기하지 않도록 8초 타임아웃(AbortController).
async function authFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const base = getBackendURL();
  if (!base) throw new Error("backend URL not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(base + path, {
      ...opts,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(opts.headers as Record<string, string>) },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function getStatus(): Promise<AuthStatusResponse> {
  if (config.useMock) return { state: "configured" };
  const res = await authFetch("/auth/status");
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export async function setup(pin: string): Promise<AuthTokenResponse> {
  if (config.useMock) return { token: MOCK_TOKEN };
  const res = await authFetch("/auth/setup", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new AuthError(body.error || `status ${res.status}`, res.status);
  }
  return res.json();
}

export async function login(pin: string): Promise<AuthTokenResponse> {
  if (config.useMock) return { token: MOCK_TOKEN };
  const res = await authFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    let code: AuthErrorCode | undefined;
    if (res.status === 401) code = "invalid_pin";
    else if (res.status === 423) code = "locked";
    throw new AuthError(body.error || `status ${res.status}`, res.status, code);
  }
  return res.json();
}
