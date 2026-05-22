// Tauri 윈도 사이즈 토글 훅.
//
// Rust 측 set_window_login(360×460) / set_window_main(1440×900) 커맨드를
// @tauri-apps/api ESM invoke로 호출(withGlobalTauri:false 전제).
// 브라우저(non-Tauri) 환경은 invoke가 reject되므로 no-op으로 폴백한다.
//
// 원본 이식: Frontend/public/js/window-size.js.

import { invoke } from "@tauri-apps/api/core";

// Tauri 런타임 여부. v2는 withGlobalTauri:false라도 내부 IPC 글로벌이 주입된다.
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function safeInvoke(command: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke(command);
  } catch (err) {
    console.error(`${command} failed:`, err);
  }
}

export async function setLoginSize(): Promise<void> {
  await safeInvoke("set_window_login");
}

export async function setMainSize(): Promise<void> {
  await safeInvoke("set_window_main");
}

// 보고서 인쇄. macOS WKWebView는 window.print() 미지원이라 Rust print_report(NSPrintOperation)로 위임.
// 브라우저(non-Tauri) 또는 invoke 실패 시 window.print() 폴백.
export async function printReport(): Promise<void> {
  if (!isTauri()) {
    window.print();
    return;
  }
  try {
    await invoke("print_report");
  } catch (err) {
    console.error("print_report failed:", err);
    window.print();
  }
}

// 컴포넌트에서 창 전환 함수를 받는 훅(안정 참조).
export function useWindow() {
  return { setLoginSize, setMainSize };
}
