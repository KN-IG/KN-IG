// 앱 루트 — 라우팅 골격 + 인증/테마 프로바이더.
//
//   라우팅: HashRouter(Tauri file:// 정적 서브 환경에 안전).
//   - /login   공개 라우트(인증 시 /app으로 리다이렉트).
//   - /app     인증 가드(미인증 시 /login으로). 빈 셸 + 탭 네비 자리.
//   - /        기본 → /app(가드가 미인증을 /login으로 보냄).
//
//   401 핸들러: client.ts의 setUnauthorizedHandler에 navigate를 주입(원본 location.replace 대체).
//   창 크기 타이밍: /app 진입(authenticated) 시 setMainSize()로 콜드부트+기존토큰 시
//   360×460 잔류 방지(원본 index.html:14 inline 호출 대체).

import { useEffect } from "react";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeProvider";
import { setUnauthorizedHandler } from "./api/client";
import { setMainSize } from "./tauri/useWindow";
import { AppShell } from "./components/layout/AppShell";
import Login from "./routes/Login";
import Dashboard from "./routes/Dashboard";
import Report from "./routes/Report";
import Logs from "./routes/Logs";
import Policy from "./routes/Policy";

// 401 발생 시 navigate를 client.ts에 주입(라우터 컨텍스트 내부에서만 가능).
// logout()으로 AuthContext state(isAuthenticated)까지 비워 stale state로 인한
// /login↔/app 무한 바운스를 차단한다(logout = cancelAll + 토큰삭제 + state=false).
function UnauthorizedBridge() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout();
      navigate("/login", { replace: true });
    });
    return () => setUnauthorizedHandler(() => {});
  }, [navigate, logout]);
  return null;
}

// 인증 가드: 미인증 시 /login으로. 인증 시 /app 진입 → 메인 창 크기 적용.
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) void setMainSize();
  }, [isAuthenticated]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// /login 진입 시 이미 인증된 경우 /app으로(중복 로그인 방지).
function LoginRoute() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/app" replace />;
  return <Login />;
}

function AppRoutes() {
  return (
    <>
      <UnauthorizedBridge />
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/app/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="report" element={<Report />} />
          <Route path="logs" element={<Logs />} />
          <Route path="policy" element={<Policy />} />
        </Route>
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
