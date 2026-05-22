// 상단 글로벌 navbar — 원본 .ig-topbar(Frontend/public/index.html:197-233) 톤 이식.
//
//   레이아웃: [브랜드] · [중앙 탭] · [우측 액션(연결상태 자리 + 테마 토글 + 로그아웃)]
//   글래스 톤: .glass-topbar 유틸(색 채널 HSL 단일출처 + 알파/blur 합성).
//   탭은 react-router NavLink로 활성 표시(Apple 톤 알약). 실제 라우트는 P4~P6에서 채움.

import { NavLink } from "react-router-dom";
import { LogOut, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/theme/ThemeProvider";
import { useConnection } from "@/state/ConnectionContext";
import knLogo from "@/assets/kn.png";

// 탭 정의 — 라우트는 후속 phase에서 활성화되며, 현재는 셸 네비게이션 자리.
const TABS = [
  { to: "/app/dashboard", label: "Dashboard" },
  { to: "/app/report", label: "Report" },
  { to: "/app/policy", label: "Policy" },
  { to: "/app/logs", label: "Logs" },
] as const;

interface NavbarProps {
  onLogout: () => void;
}

export function Navbar({ onLogout }: NavbarProps) {
  const { theme, toggle } = useTheme();
  const { connected } = useConnection();

  return (
    <header className="glass-topbar sticky top-0 z-30 border-b border-transparent">
      <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-6 px-6 py-3">
        {/* 브랜드 */}
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[9px] bg-white shadow-glass-sm ring-1 ring-border">
            <img src={knLogo} alt="KN-IG" className="h-full w-full object-cover" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[15.5px] font-semibold tracking-tight text-foreground">
              KN-IG
            </span>
            <span className="text-[11px] font-normal text-muted-foreground">
              무결성 보안 리포트
            </span>
          </span>
        </div>

        {/* 중앙 탭 (Apple 톤 알약) */}
        <nav className="flex justify-self-center gap-1">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        {/* 우측 액션 */}
        <div className="flex items-center justify-self-end gap-2.5">
          {/* 연결 상태 자리 — 실제 dot/라벨은 P4에서 연결 */}
          <div
            data-slot="connection-status"
            className="flex items-center gap-1.5 text-[13px] text-muted-foreground"
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                connected === null
                  ? "bg-muted-foreground/50"
                  : connected
                    ? "bg-emerald-500"
                    : "bg-rose-500",
              )}
            />
            <span>
              {connected === null ? "연결 대기" : connected ? "연결됨" : "연결 끊김"}
            </span>
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={toggle}
            title="테마 전환"
            aria-label="테마 전환"
            className="rounded-full"
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={onLogout}
            title="로그아웃"
            aria-label="로그아웃"
            className="rounded-full"
          >
            <LogOut />
          </Button>
        </div>
      </div>
    </header>
  );
}
