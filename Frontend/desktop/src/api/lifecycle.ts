// 활성 폴링(setInterval)/in-flight 요청 수명주기 레지스트리.
//
// 401 감지(client.ts) 또는 로그아웃 시 cancelAll()로 모든 타이머와
// in-flight fetch를 정지시켜 고아 타이머·중복 리다이렉트를 방지한다.
// P2에서 인프라만 깔고, 폴링 훅(P4)이 register*로 자기 자원을 등록한다.

const intervals = new Set<ReturnType<typeof setInterval>>();
const controllers = new Set<AbortController>();

// 폴링 타이머 등록. 반환된 해제 함수로 언마운트 시 정리한다.
export function registerInterval(id: ReturnType<typeof setInterval>): () => void {
  intervals.add(id);
  return () => {
    clearInterval(id);
    intervals.delete(id);
  };
}

// in-flight 요청의 AbortController 등록. 요청 완료 시 해제 함수로 정리한다.
export function registerController(controller: AbortController): () => void {
  controllers.add(controller);
  return () => {
    controllers.delete(controller);
  };
}

// 모든 활성 폴링 타이머와 in-flight 요청을 정지한다(401/로그아웃 경로).
export function cancelAll(): void {
  for (const id of intervals) {
    clearInterval(id);
  }
  intervals.clear();
  for (const controller of controllers) {
    controller.abort();
  }
  controllers.clear();
}
