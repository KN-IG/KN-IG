// 인증 컨텍스트 + 상태머신.
//
//   상태머신: load → /auth/status → { setup | login | locked }
//   - unconfigured → setup 모드(PIN 최초 생성)
//   - configured   → login 모드(PIN 입력)
//   - locked       → 잠금 화면
//
//   토큰: localStorage 'ig.session.token'. 존재 시 인증된 것으로 간주(원본 토큰 가드와 동일).
//   setup/login 성공 시 토큰 저장 → authenticated 전이.
//   logout 시 폴링 정지 + 토큰 삭제 → unauthenticated 전이.
//
// 원본 이식: Frontend/public/js/auth.js, index.html:9-12(토큰 가드).

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import * as authClient from "../api/authClient";
import { cancelAll } from "../api/lifecycle";
import { TOKEN_KEY } from "../api/client";

interface AuthContextValue {
  isAuthenticated: boolean;
  getStatus: () => Promise<authClient.AuthStatusResponse>;
  setup: (pin: string) => Promise<void>;
  login: (pin: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    () => !!localStorage.getItem(TOKEN_KEY),
  );

  const getStatus = useCallback(() => authClient.getStatus(), []);

  const setup = useCallback(async (pin: string) => {
    const { token } = await authClient.setup(pin);
    localStorage.setItem(TOKEN_KEY, token);
    setIsAuthenticated(true);
  }, []);

  const login = useCallback(async (pin: string) => {
    const { token } = await authClient.login(pin);
    localStorage.setItem(TOKEN_KEY, token);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    cancelAll();
    localStorage.removeItem(TOKEN_KEY);
    setIsAuthenticated(false);
  }, []);

  const value = useMemo(
    () => ({ isAuthenticated, getStatus, setup, login, logout }),
    [isAuthenticated, getStatus, setup, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
