// 최상위 에러 경계 — 렌더 중 예외를 잡아 흰 화면 대신 복구 안내를 표시한다.
// 계획 Observability(pre-mortem 시나리오 1: release 흰 화면 방지) 충족.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("UI 렌더 오류:", error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-8 text-center text-foreground">
          <h1 className="text-lg font-semibold">화면을 표시하는 중 오류가 발생했습니다</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            콘솔을 다시 시작해 주십시오. 문제가 지속되면 관리자에게 문의해 주십시오.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
