// 공통 폴링 훅. 즉시 1회 실행 + intervalMs 주기 반복.
// 타이머를 lifecycle 레지스트리에 등록 → 401/로그아웃 시 cancelAll로 함께 정지.
// 언마운트 시에도 정리(고아 타이머 방지). 원본 app.js:36 setInterval 패턴 대체.
import { useCallback, useEffect, useRef, useState } from "react";
import { registerInterval } from "../lifecycle";

export interface PollingState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  onResult?: (ok: boolean) => void,
): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const aliveRef = useRef(true);

  const run = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      if (!aliveRef.current) return;
      setData(result);
      setError(null);
      onResultRef.current?.(true);
    } catch (e) {
      if (!aliveRef.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
      onResultRef.current?.(false);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void run();
    const id = setInterval(run, intervalMs);
    const unregister = registerInterval(id);
    return () => {
      aliveRef.current = false;
      unregister();
    };
  }, [run, intervalMs]);

  return { data, error, loading, refetch: run };
}
