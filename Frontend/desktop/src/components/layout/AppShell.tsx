// 인증된 메인 셸 — Navbar + 콘텐츠 영역(Outlet).
//
//   ConnectionProvider로 감싸 Navbar 연결 dot과 페이지 폴링 상태(useDashboardData)를 공유한다.
//   실제 페이지(Dashboard/Report/Logs/Policy)는 중첩 라우트로 채운다(App.tsx).
//   로그아웃: AuthContext.logout()으로 토큰/폴링 정리 후 로그인 창 크기(360×460)로 축소
//   logout 핸들러 동작 보존.

import { Outlet } from "react-router-dom";
import { Navbar } from "./Navbar";
import { useAuth } from "@/auth/AuthContext";
import { setLoginSize } from "@/tauri/useWindow";
import { ConnectionProvider } from "@/state/ConnectionContext";

export function AppShell() {
  const { logout } = useAuth();

  const handleLogout = () => {
    void setLoginSize();
    logout();
  };

  return (
    <ConnectionProvider>
      <div className="min-h-screen bg-background text-foreground">
        <Navbar onLogout={handleLogout} />
        <main className="mx-auto max-w-6xl px-6 py-6">
          <Outlet />
        </main>
      </div>
    </ConnectionProvider>
  );
}
