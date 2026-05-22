// 로그인 라우트.
//
//   상태머신: load → /auth/status → { setup | login | locked }
//   - PIN 입력/확인, 에러/잠금/연결오류/재시도 패널.
//   - 인증 성공 시 setMainSize() 호출 후 /app으로 이동(원본 auth.js:170-172 대체).
//   - 진입 시 setLoginSize()로 로그인 창 크기 적용(원본 auth.js:213 대체).
//
// 원본 이식: Frontend/public/login.html + js/auth.js.
// 변경점: Tailwind CDN 제거(Vite JIT), 시스템 카피는 회사용 "합니다"체.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { setLoginSize, setMainSize } from "../tauri/useWindow";
import { AuthError } from "../api/authClient";
import { config } from "../config";
import knLogo from "../assets/kn.png";

type View = "loading" | "form" | "locked" | "config-error";
type Mode = "setup" | "login";

function isValidPin(pin: string): boolean {
  return /^[0-9]{4,8}$/.test(pin);
}

export default function Login() {
  const navigate = useNavigate();
  const { getStatus, setup, login } = useAuth();

  const [view, setView] = useState<View>("loading");
  const [mode, setMode] = useState<Mode>("login");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [configErrorMsg, setConfigErrorMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);

  // 상태 조회 후 화면 모드 결정(원본 loadStatusAndRender).
  const loadStatus = useCallback(async () => {
    setView("loading");
    setError("");
    if (!config.backendUrl) {
      setConfigErrorMsg("콘솔 빌드가 구성되지 않았습니다. 관리자에게 문의합니다.");
      setView("config-error");
      return;
    }
    try {
      const { state } = await getStatus();
      if (state === "locked") {
        setView("locked");
        return;
      }
      setMode(state === "unconfigured" ? "setup" : "login");
      setView("form");
    } catch {
      setConfigErrorMsg("중앙 서버에 연결할 수 없습니다. 네트워크를 확인하고 다시 시도합니다.");
      setView("config-error");
    }
  }, [getStatus]);

  // 진입: 로그인 창 크기 적용 + 상태 조회(원본 auth.js:213-214).
  useEffect(() => {
    void setLoginSize();
    void loadStatus();
  }, [loadStatus]);

  // form 진입 시 PIN 입력에 포커스.
  useEffect(() => {
    if (view === "form") pinInputRef.current?.focus();
  }, [view, mode]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");

      const trimmed = pin.trim();
      if (!isValidPin(trimmed)) {
        setError("PIN은 4~8자리 숫자여야 합니다.");
        return;
      }
      if (mode === "setup" && trimmed !== confirmPin.trim()) {
        setError("PIN이 일치하지 않습니다.");
        return;
      }

      setSubmitting(true);
      try {
        if (mode === "setup") {
          await setup(trimmed);
        } else {
          await login(trimmed);
        }
        await setMainSize();
        navigate("/app", { replace: true });
      } catch (err) {
        if (err instanceof AuthError && err.code === "invalid_pin") {
          setError("PIN이 올바르지 않습니다.");
        } else if (err instanceof AuthError && err.code === "locked") {
          setView("locked");
        } else {
          setError(err instanceof Error && err.message ? err.message : "서버 오류가 발생했습니다. 다시 시도합니다.");
        }
        setPin("");
        setConfirmPin("");
        pinInputRef.current?.focus();
      } finally {
        setSubmitting(false);
      }
    },
    [pin, confirmPin, mode, setup, login, navigate],
  );

  const title =
    view === "loading"
      ? "불러오는 중"
      : view === "config-error"
        ? "연결 오류"
        : view === "locked"
          ? "잠김"
          : mode === "setup"
            ? "PIN 설정"
            : "로그인";

  const subtitle =
    view === "loading"
      ? "콘솔에 연결하는 중입니다."
      : view === "locked"
        ? "로그인 시도가 너무 많습니다."
        : view === "form"
          ? mode === "setup"
            ? "최초 로그인을 위한 PIN을 설정합니다."
            : "계속하려면 PIN을 입력합니다."
          : "";

  return (
    <main className="bg-background text-foreground min-h-screen flex flex-col justify-center">
      <div className="px-6 pt-8 pb-2 flex flex-col items-center gap-2">
        <img src={knLogo} alt="KN-IG" className="w-12 h-12 rounded-full object-cover" />
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground text-center">{subtitle}</p>}
      </div>

      {view === "config-error" && (
        <div className="px-6 pt-4 pb-6 flex flex-col gap-3">
          <p className="text-sm text-destructive text-center">{configErrorMsg}</p>
          <button
            type="button"
            onClick={() => void loadStatus()}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md text-sm font-medium"
          >
            다시 시도
          </button>
        </div>
      )}

      {view === "form" && (
        <form onSubmit={handleSubmit} className="px-6 pt-4 pb-6 flex flex-col gap-4">
          <div>
            <label htmlFor="pin-input" className="block text-sm font-medium text-foreground mb-1">
              PIN
            </label>
            <input
              id="pin-input"
              ref={pinInputRef}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              pattern="[0-9]{4,8}"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder={mode === "setup" ? "••••" : ""}
              className="w-full border border-input bg-card text-foreground rounded-md px-3 py-2 text-base tracking-widest text-center font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {mode === "setup" && (
            <div>
              <label htmlFor="pin-confirm" className="block text-sm font-medium text-foreground mb-1">
                PIN 확인
              </label>
              <input
                id="pin-confirm"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                pattern="[0-9]{4,8}"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                placeholder="••••"
                className="w-full border border-input bg-card text-foreground rounded-md px-3 py-2 text-base tracking-widest text-center font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md text-sm font-medium disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
          >
            {mode === "setup" ? "PIN 설정" : "로그인"}
          </button>

          {mode === "setup" && (
            <p className="text-xs text-muted-foreground text-center">PIN은 4~8자리 숫자여야 합니다.</p>
          )}
        </form>
      )}

      {view === "locked" && (
        <div className="px-6 pt-4 pb-8">
          <p className="text-sm text-destructive text-center">콘솔이 잠겼습니다. 잠시 후 다시 시도합니다.</p>
        </div>
      )}
    </main>
  );
}
