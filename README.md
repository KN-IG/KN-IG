# KN-IG

망분리 OT 환경을 위한 파일 무결성 감시 시스템. 에이전트가 커널(eBPF/LKM)에서 변조를
탐지·차단하고, 중앙 서버가 수집·저장하며, 콘솔이 대시보드·리포트로 보여줍니다.

| 구성 | 역할 | 문서 |
|---|---|---|
| **Agent** (C, Linux) | 커널 후킹으로 무결성 변조 탐지/차단 → 중앙 전송(mTLS) | [Agent/](Agent/README.md) |
| **Backend** (Go) | TCP collector 수집·MySQL 저장·REST/SSE | [Backend/](Backend/README.md) |
| **LLM** (FastAPI) | 기간 종합 리포트 생성(숫자=코드, 서술=LLM) | [LLM/](LLM/README.md) |
| **Console** (Tauri) | 관리자 GUI(대시보드·리포트·로그·정책) | [Frontend/](Frontend/README.md) |

## 배포

각 VM에서 **역할 한 줄** (단일 진입점 `kn-ig`):

```bash
git clone <repo> && cd KN-IG
sudo ./kn-ig --server          # 중앙(Backend+MySQL)  :8080 · :9000
sudo ./kn-ig --llm             # LLM                  :8088
sudo ./kn-ig --agent <중앙IP>   # Agent (인증서 물리 삽입 후)
     ./kn-ig --verify          # 검증 (FAIL=0 이면 완료)
```

배포·검증 상세: [deploy/README.md](deploy/README.md) · [docs/verification.md](docs/verification.md).

# Members
Kang jiwoon  
Kim juhwan  
Kim Taewoo  
Na Wonhyun  
