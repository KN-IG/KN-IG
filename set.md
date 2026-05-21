# KN-IG Setup → `kn-ig` 로 이관됨

배포는 각 VM 터미널에서 **역할 한 줄**입니다.

```bash
git clone <repo> && cd KN-IG
sudo ./kn-ig --server      # 중앙 서버 VM
sudo ./kn-ig --llm         # LLM 서버 VM
sudo ./kn-ig --agent <중앙IP>   # Agent VM (ca/agent 인증서 물리 삽입 후)
     ./kn-ig --verify      # 검증 (FAIL=0 이면 완료)
```

자세한 내용·토폴로지·인증서·트러블슈팅·검증 한계는 **[`deploy/README.md`](deploy/README.md)** 참고.

> 과거 `setup_backend_agent_runtime.sh`, `setup/`, 제어호스트용 `deploy.sh`/`cluster.env` 마법사는 `kn-ig` 단일 모델로 대체되어 정리되었습니다.
