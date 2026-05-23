// Central Server 연결 상태 공유. 폴링 훅(useDashboardData)이 성공/실패를 보고하고,
// Navbar의 연결 dot이 이를 구독한다.
import { createContext, useContext, useState, type ReactNode } from "react";

interface ConnectionState {
  connected: boolean | null; // null = 아직 시도 전
  setConnected: (ok: boolean) => void;
}

const ConnectionContext = createContext<ConnectionState | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  return (
    <ConnectionContext.Provider value={{ connected, setConnected }}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection(): ConnectionState {
  const ctx = useContext(ConnectionContext);
  if (!ctx) {
    throw new Error("useConnection must be used within ConnectionProvider");
  }
  return ctx;
}
