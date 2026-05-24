// /api/events/stream SSE 구독 훅.
// 백엔드는 agent가 FILE_EVENT를 보내면 즉시 SSE로 push한다(sse.go). 이 훅은 그 메시지를
// '변경 발생' 신호로만 받아 onSignal을 호출한다 — 데이터 파싱은 소비측 refetch에 맡긴다
// (이벤트/agent 상태를 한 번에 최신화, merge 중복 없음). 연결이 끊기면 자동 재연결.
import { useEffect, useRef } from "react";
import { apiFetch } from "../client";
import { config } from "../../config";

export function useEventStream(onSignal: () => void): void {
  const cbRef = useRef(onSignal);
  cbRef.current = onSignal;

  useEffect(() => {
    if (config.useMock) return; // mock 환경엔 백엔드 SSE가 없음
    let stopped = false;
    let abort: AbortController | null = null;
    let retry: number | null = null;

    async function connect() {
      if (stopped) return;
      abort = new AbortController();
      try {
        const res = await apiFetch("/api/events/stream", {
          headers: { Accept: "text/event-stream" },
          signal: abort.signal,
        });
        const reader = res.body?.getReader();
        if (!reader) throw new Error("스트림 본문 없음");
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (frame.includes("data:")) cbRef.current();
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // 정상 종료
      }
      if (!stopped) retry = window.setTimeout(connect, 2000); // 끊김 → 재연결
    }
    void connect();

    return () => {
      stopped = true;
      abort?.abort();
      if (retry !== null) window.clearTimeout(retry);
    };
  }, []);
}
