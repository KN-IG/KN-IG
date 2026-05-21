package collector

// mTLS 통합 테스트 — 실제 collector 서버(NewTLSConfig + NewServer + Start)를 그대로 띄우고
// 진짜 mTLS 클라이언트(에이전트 클라이언트 인증서)로 접속해, 4-VM 런타임의 Agent↔중앙 경로
// (TLS 핸드셰이크 → REGISTER → ACK → HEARTBEAT → FILE_EVENT)가 동작함을 in-process로 증명한다.
//
// MySQL 대신 in-memory mock 스토어를 쓰지만(정당한 테스트 경계), TLS·프로토콜·세션·핸들러는
// 전부 실제 출하 코드다. 이 환경(VM 없음)에서 가능한 최고 충실도의 런타임 증거.

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/KN-IG/KN-IG/Backend/internal"
)

// ── in-memory mock 스토어 (MySQL 대체) ────────────────────────────────────
type mockAgentStore struct {
	mu         sync.Mutex
	registered map[string]internal.RegisterPayload
	heartbeats int
	offline    int
}

func newMockAgentStore() *mockAgentStore {
	return &mockAgentStore{registered: map[string]internal.RegisterPayload{}}
}
func (m *mockAgentStore) RegisterAgent(_ context.Context, id string, p internal.RegisterPayload) error {
	m.mu.Lock(); defer m.mu.Unlock(); m.registered[id] = p; return nil
}
func (m *mockAgentStore) UpdateHeartbeat(_ context.Context, _ string, _ time.Time) error {
	m.mu.Lock(); defer m.mu.Unlock(); m.heartbeats++; return nil
}
func (m *mockAgentStore) SetOffline(_ context.Context, _ string) error {
	m.mu.Lock(); defer m.mu.Unlock(); m.offline++; return nil
}
func (m *mockAgentStore) ListAgents(_ context.Context) ([]internal.Agent, error) { return nil, nil }
func (m *mockAgentStore) GetAgent(_ context.Context, _ string) (internal.Agent, error) {
	return internal.Agent{}, nil
}
func (m *mockAgentStore) DeleteAgent(_ context.Context, _ string) error          { return nil }
func (m *mockAgentStore) UpdateStatus(_ context.Context, _ string, _ string) error { return nil }

type mockEventStore struct {
	mu     sync.Mutex
	events []internal.FileEventPayload
}
func (m *mockEventStore) SaveEvent(_ context.Context, p internal.FileEventPayload) error {
	m.mu.Lock(); defer m.mu.Unlock(); m.events = append(m.events, p); return nil
}
func (m *mockEventStore) QueryEvents(_ context.Context, _ internal.EventFilter) ([]internal.FileEvent, error) {
	return nil, nil
}
func (m *mockEventStore) count() int { m.mu.Lock(); defer m.mu.Unlock(); return len(m.events) }

type mockAlertStore struct{}
func (mockAlertStore) CreateAlert(_ context.Context, _, _, _ string) error { return nil }
func (mockAlertStore) ListAlerts(_ context.Context, _ internal.AlertFilter) ([]internal.Alert, error) {
	return nil, nil
}
func (mockAlertStore) ResolveAlert(_ context.Context, _ int64) error { return nil }

type mockPublisher struct{ mu sync.Mutex; published int }
func (m *mockPublisher) Publish(_ internal.FileEvent) { m.mu.Lock(); defer m.mu.Unlock(); m.published++ }
func (m *mockPublisher) Subscribe() <-chan internal.FileEvent { return make(chan internal.FileEvent) }
func (m *mockPublisher) count() int { m.mu.Lock(); defer m.mu.Unlock(); return m.published }

// ── Go로 mTLS 인증서 3종 생성 (CA / server[IP SAN] / agent[clientAuth]) ───
func writePEM(t *testing.T, path, typ string, der []byte) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil { t.Fatal(err) }
	defer f.Close()
	if err := pem.Encode(f, &pem.Block{Type: typ, Bytes: der}); err != nil { t.Fatal(err) }
}

func genMTLSCerts(t *testing.T, dir string) (ca, sCrt, sKey, aCrt, aKey string) {
	t.Helper()
	mk := func(name string) *rsa.PrivateKey {
		k, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil { t.Fatalf("genkey %s: %v", name, err) }
		return k
	}
	now := time.Now()
	caKey := mk("ca")
	caTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "KN-IG Test CA"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(24 * time.Hour),
		IsCA: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	caDER, _ := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	caCert, _ := x509.ParseCertificate(caDER)

	srvKey := mk("server")
	srvTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "KN-IG Backend"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(24 * time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, DNSNames: []string{"localhost"},
	}
	srvDER, _ := x509.CreateCertificate(rand.Reader, srvTmpl, caCert, &srvKey.PublicKey, caKey)

	agKey := mk("agent")
	agTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(3), Subject: pkix.Name{CommonName: "KN-IG Agent"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(24 * time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	agDER, _ := x509.CreateCertificate(rand.Reader, agTmpl, caCert, &agKey.PublicKey, caKey)

	ca = filepath.Join(dir, "ca.crt")
	sCrt = filepath.Join(dir, "server.crt"); sKey = filepath.Join(dir, "server.key")
	aCrt = filepath.Join(dir, "agent.crt"); aKey = filepath.Join(dir, "agent.key")
	writePEM(t, ca, "CERTIFICATE", caDER)
	writePEM(t, sCrt, "CERTIFICATE", srvDER)
	writePEM(t, sKey, "RSA PRIVATE KEY", x509.MarshalPKCS1PrivateKey(srvKey))
	writePEM(t, aCrt, "CERTIFICATE", agDER)
	writePEM(t, aKey, "RSA PRIVATE KEY", x509.MarshalPKCS1PrivateKey(agKey))
	return
}

// 전체 런타임 경로: mTLS 핸드셰이크 → REGISTER → ACK → HEARTBEAT → FILE_EVENT
func TestMTLSAgentToCentralFlow(t *testing.T) {
	dir := t.TempDir()
	ca, sCrt, sKey, aCrt, aKey := genMTLSCerts(t, dir)

	// 실제 서버 TLS 설정 (출하 코드)
	srvTLS, err := NewTLSConfig(ca, sCrt, sKey)
	if err != nil { t.Fatalf("NewTLSConfig: %v", err) }

	// 빈 포트 확보
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil { t.Fatal(err) }
	addr := l.Addr().String()
	l.Close()

	agents := newMockAgentStore()
	events := &mockEventStore{}
	pub := &mockPublisher{}
	var onEventCalls int
	onEvent := func(_ context.Context, _ string, _ internal.FileEvent) { onEventCalls++ }

	srv := NewServer(addr, srvTLS, agents, events, mockAlertStore{}, pub, onEvent)
	go func() { _ = srv.Start() }() // blocking — 고루틴

	// 클라이언트 TLS (에이전트 인증서로 mTLS)
	caPEM, _ := os.ReadFile(ca)
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) { t.Fatal("CA 풀 로드 실패") }
	cliCert, err := tls.LoadX509KeyPair(aCrt, aKey)
	if err != nil { t.Fatalf("agent 인증서 로드: %v", err) }
	cliCfg := &tls.Config{
		RootCAs: pool, Certificates: []tls.Certificate{cliCert},
		ServerName: "127.0.0.1", MinVersion: tls.VersionTLS12,
	}

	// 서버 기동 대기 + mTLS 핸드셰이크
	var conn *tls.Conn
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		c, derr := tls.Dial("tcp", addr, cliCfg)
		if derr == nil { conn = c; break }
		time.Sleep(50 * time.Millisecond)
	}
	if conn == nil { t.Fatal("mTLS 연결 실패 — 핸드셰이크 불가") }
	defer conn.Close()
	t.Logf("mTLS 핸드셰이크 OK (cipher=%s, ver=%#x)", tls.CipherSuiteName(conn.ConnectionState().CipherSuite), conn.ConnectionState().Version)

	// REGISTER (seq=1) — 에이전트 인코딩 그대로
	var rp bytes.Buffer
	knigPutStr(&rp, "ot-host-1")
	rp.Write(net.ParseIP("192.168.64.31").To4())
	rp.WriteByte(MonEbpf)
	knigPutStr(&rp, "Linux")
	if err := WriteFrame(conn, MsgRegister, 1, rp.Bytes()); err != nil { t.Fatalf("REGISTER 전송: %v", err) }

	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	hdr, ackPayload, err := ReadFrame(conn)
	if err != nil { t.Fatalf("ACK 수신: %v", err) }
	if hdr.Type != MsgRegister || len(ackPayload) != 8 { t.Fatalf("ACK 비정상 type=%#x len=%d", hdr.Type, len(ackPayload)) }
	agentID := binary.BigEndian.Uint64(ackPayload)
	wantID := GenerateAgentID("ot-host-1", net.ParseIP("192.168.64.31"))
	if agentID != wantID { t.Fatalf("ACK agent_id=%d, 기대=%d", agentID, wantID) }
	t.Logf("REGISTER OK → agent_id=%d", agentID)

	// HEARTBEAT (seq=2)
	hb := make([]byte, 13)
	binary.BigEndian.PutUint64(hb[0:8], agentID)
	hb[8] = StatusOnline
	binary.BigEndian.PutUint32(hb[9:13], uint32(time.Now().Unix()))
	if err := WriteFrame(conn, MsgHeartbeat, 2, hb); err != nil { t.Fatalf("HEARTBEAT: %v", err) }

	// FILE_EVENT (seq=3)
	var ep bytes.Buffer
	var aid [8]byte; binary.BigEndian.PutUint64(aid[:], agentID); ep.Write(aid[:])
	ep.WriteByte(EvtModify)
	knigPutStr(&ep, "/etc/skel/.bashrc")
	knigPutStr(&ep, ".bashrc")
	var perm [2]byte; binary.BigEndian.PutUint16(perm[:], 0o644); ep.Write(perm[:])
	ep.WriteByte(MonEbpf)
	var pid [4]byte; binary.BigEndian.PutUint32(pid[:], 4242); ep.Write(pid[:])
	var ts [4]byte; binary.BigEndian.PutUint32(ts[:], uint32(time.Now().Unix())); ep.Write(ts[:])
	if err := WriteFrame(conn, MsgFileEvent, 3, ep.Bytes()); err != nil { t.Fatalf("FILE_EVENT: %v", err) }

	// 서버 비동기 처리 대기 후 mock 검증
	ok := false
	for i := 0; i < 50; i++ {
		if events.count() >= 1 { ok = true; break }
		time.Sleep(50 * time.Millisecond)
	}
	if !ok { t.Fatal("FILE_EVENT가 SaveEvent로 저장되지 않음") }

	idStr := "" // 등록 확인
	agents.mu.Lock()
	for k := range agents.registered { idStr = k }
	regCount := len(agents.registered)
	agents.mu.Unlock()
	if regCount != 1 { t.Fatalf("등록 agent 수=%d (1 기대)", regCount) }

	// 저장된 이벤트 내용 검증
	events.mu.Lock(); ev := events.events[0]; events.mu.Unlock()
	if ev.EventType != "MODIFY" || ev.FilePath != "/etc/skel/.bashrc" || ev.DetectedBy != "ebpf" {
		t.Fatalf("저장 이벤트 불일치: %+v", ev)
	}
	if pub.count() < 1 { t.Fatal("SSE Publish 미호출") }

	t.Logf("실제 작동 검증 완료: 등록 agent_id=%s, 저장 이벤트=%d, SSE publish=%d, engine onEvent=%d",
		idStr, events.count(), pub.count(), onEventCalls)
}

// 잘못된 CA로 서명된 클라이언트는 mTLS 거부되어야 한다(RequireAndVerifyClientCert).
func TestMTLSRejectsUnknownClientCert(t *testing.T) {
	dir := t.TempDir()
	ca, sCrt, sKey, _, _ := genMTLSCerts(t, dir)
	// 별도(신뢰되지 않은) CA로 클라이언트 인증서 발급
	otherDir := t.TempDir()
	_, _, _, badCrt, badKey := genMTLSCerts(t, otherDir)

	srvTLS, err := NewTLSConfig(ca, sCrt, sKey)
	if err != nil { t.Fatal(err) }
	l, _ := net.Listen("tcp", "127.0.0.1:0"); addr := l.Addr().String(); l.Close()
	srv := NewServer(addr, srvTLS, newMockAgentStore(), &mockEventStore{}, mockAlertStore{}, &mockPublisher{},
		func(context.Context, string, internal.FileEvent) {})
	go func() { _ = srv.Start() }()
	time.Sleep(200 * time.Millisecond)

	caPEM, _ := os.ReadFile(ca)
	pool := x509.NewCertPool(); pool.AppendCertsFromPEM(caPEM)
	badCert, _ := tls.LoadX509KeyPair(badCrt, badKey)
	cfg := &tls.Config{RootCAs: pool, Certificates: []tls.Certificate{badCert}, ServerName: "127.0.0.1", MinVersion: tls.VersionTLS12}

	conn, err := tls.Dial("tcp", addr, cfg)
	if err == nil {
		// 핸드셰이크가 늦게 실패할 수 있으니 write/read까지 시도
		conn.SetDeadline(time.Now().Add(2 * time.Second))
		_, _, rerr := ReadFrame(conn)
		conn.Close()
		if rerr == nil { t.Fatal("신뢰되지 않은 클라이언트 인증서가 수락됨 — mTLS 검증 실패") }
	}
	t.Log("신뢰되지 않은 클라이언트 인증서 거부 확인(mTLS)")
}
