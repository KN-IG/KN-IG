# KN-IG 검증 (방법 · 순서)

**설치 순서 = 검증 순서.** 각 단계 직후 그 VM에서 `kn-ig --status`, 마지막에 어디서나 `kn-ig --verify`.

```
중앙(--server) → LLM(--llm) → Agent(--agent <중앙IP>) → kn-ig --verify
                                                          ├ FAIL=0 → ✅ 완료
                                                          └ FAIL>0 → 고치고 재실행(멱등)
```

## 순서

```bash
# 1. 중앙 서버 VM
sudo ./kn-ig --server   &&  kn-ig --status

# 2. LLM 서버 VM
sudo ./kn-ig --llm      &&  kn-ig --status

# 3. Agent VM ×N   (중앙의 ca/agent 인증서를 Agent/certs/ 에 물리적으로 삽입 후)
sudo ./kn-ig --agent <중앙IP>   &&  kn-ig --status

# 4. 전체 검증 (어디서나)
kn-ig --verify                 # FAIL=0 이면 완료
kn-ig --verify --event-test    # 이벤트 흐름까지 증명
```

## `kn-ig --verify` 가 보는 것

`1 중앙(:8080·:9000)` · `2 LLM(/health)` · `3 중앙→LLM` · `4 에이전트 online` · `5 이벤트`
→ 마지막 줄 **`FAIL=0`** 이면 콘솔↔중앙↔DB · 중앙↔LLM · Agent↔중앙이 실제로 동작합니다.

## FAIL 이면

출력의 처방을 따른 뒤 **그 VM에서 `kn-ig` 를 다시 실행**하면 됩니다(멱등).
로그는 `kn-ig --logs`, 원인 분석은 [troubleshooting.md](troubleshooting.md).

## 이벤트 흐름 수동 확인

```bash
# Agent VM — 보호 대상에 무해한 쓰기
sudo bash -c 'echo "# test" >> /etc/skel/.bashrc'
# 중앙 서버 — 이벤트 도착 확인
curl -s "http://127.0.0.1:8080/api/events?limit=5" | jq .
```
