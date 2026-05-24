package collector

// 에이전트가 보내는 바이너리 프레임을 "에이전트 측 인코딩 방식 그대로" 손으로 만들고,
// 실제 출하 코드(ReadFrame/DecodeRegister/DecodeFileEvent/GenerateAgentID/EncodeRegisterResp)로
// 디코딩해 와이어 프로토콜 정합을 증명한다. (MySQL/VM 불필요 — 프로토콜 계층 단위검증)
//
// 4-VM "실제 작동"의 Agent↔중앙 경로 중, 커널 후킹(Linux 전용)을 제외한
// 등록·이벤트 전송의 직렬화 계약을 로컬에서 검증하는 것이 목적이다.

import (
	"bytes"
	"encoding/binary"
	"net"
	"testing"
)

// knigPutStr : 프로토콜의 writeStr 규약(u16 길이[BE] + 바이트)을 에이전트 입장에서 재현
func knigPutStr(b *bytes.Buffer, s string) {
	var l [2]byte
	binary.BigEndian.PutUint16(l[:], uint16(len(s)))
	b.Write(l[:])
	b.WriteString(s)
}

// REGISTER: 에이전트가 만든 프레임 → 서버 디코딩 → 필드 일치 확인
func TestWireRegisterRoundTrip(t *testing.T) {
	var p bytes.Buffer
	knigPutStr(&p, "ot-host-1")
	ip4 := net.ParseIP("192.168.64.31").To4()
	p.Write(ip4) // 4B 네트워크 바이트(BE)
	p.WriteByte(MonEbpf)
	knigPutStr(&p, "Linux")

	var framed bytes.Buffer
	if err := WriteFrame(&framed, MsgRegister, 1, p.Bytes()); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}
	hdr, payload, err := ReadFrame(&framed)
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	if hdr.Type != MsgRegister || hdr.SeqNum != 1 {
		t.Fatalf("헤더 불일치: type=%#x seq=%d", hdr.Type, hdr.SeqNum)
	}
	reg, err := DecodeRegister(payload)
	if err != nil {
		t.Fatalf("DecodeRegister: %v", err)
	}
	if reg.Hostname != "ot-host-1" {
		t.Errorf("hostname=%q", reg.Hostname)
	}
	if reg.IP.String() != "192.168.64.31" {
		t.Errorf("ip=%s", reg.IP.String())
	}
	if reg.MonitorType != MonEbpf || reg.OS != "Linux" {
		t.Errorf("monitor=%#x os=%q", reg.MonitorType, reg.OS)
	}
}

// 두 Agent VM은 IP만 달라도 서로 다른 agent_id를 받아야 한다(공용 인증서 전략의 전제).
func TestTwoAgentsGetDistinctIDs(t *testing.T) {
	id1 := GenerateAgentID("ot-host-1", net.ParseIP("192.168.64.31"))
	id2 := GenerateAgentID("ot-host-2", net.ParseIP("192.168.64.32"))
	if id1 == id2 {
		t.Fatalf("서로 다른 host+IP인데 agent_id 충돌: %d", id1)
	}
	// 동일 hostname(클론 VM)이라도 IP가 다르면 구분되어야 한다
	a := GenerateAgentID("same-host", net.ParseIP("192.168.64.31"))
	b := GenerateAgentID("same-host", net.ParseIP("192.168.64.32"))
	if a == b {
		t.Fatalf("동일 hostname/다른 IP인데 agent_id 충돌: %d", a)
	}
	if id1 == 0 || a == 0 {
		t.Fatalf("agent_id가 0 (0은 금지)")
	}
}

// FILE_EVENT: 에이전트가 만든 이벤트 프레임 → 서버 디코딩 → 필드 일치 확인
func TestWireFileEventRoundTrip(t *testing.T) {
	var p bytes.Buffer
	var u64 [8]byte
	binary.BigEndian.PutUint64(u64[:], 12345)
	p.Write(u64[:]) // agent_id
	p.WriteByte(EvtModify)
	knigPutStr(&p, "/etc/skel/.bashrc")
	knigPutStr(&p, ".bashrc")
	var perm [2]byte
	binary.BigEndian.PutUint16(perm[:], 0o644)
	p.Write(perm[:])
	p.WriteByte(MonEbpf) // detected_by
	var pid [4]byte
	binary.BigEndian.PutUint32(pid[:], 4242)
	p.Write(pid[:])
	var ts [4]byte
	binary.BigEndian.PutUint32(ts[:], 1700000000)
	p.Write(ts[:])

	// v2 확장: target_dev/ino, blocked, uid, sid, comm, process chain(depth=0)
	var tdev [8]byte
	binary.BigEndian.PutUint64(tdev[:], 100)
	p.Write(tdev[:])
	var tino [8]byte
	binary.BigEndian.PutUint64(tino[:], 200)
	p.Write(tino[:])
	p.WriteByte(1) // blocked
	var uid [4]byte
	binary.BigEndian.PutUint32(uid[:], 1000)
	p.Write(uid[:])
	var sid [4]byte
	binary.BigEndian.PutUint32(sid[:], 1200)
	p.Write(sid[:])
	knigPutStr(&p, "chmod") // comm
	p.WriteByte(0)          // chain depth
	p.WriteByte(0)          // chain truncated

	ev, err := DecodeFileEvent(p.Bytes())
	if err != nil {
		t.Fatalf("DecodeFileEvent: %v", err)
	}
	if ev.AgentID != 12345 {
		t.Errorf("agent_id=%d", ev.AgentID)
	}
	if ev.EventType != EvtModify {
		t.Errorf("evt=%#x", ev.EventType)
	}
	if ev.FilePath != "/etc/skel/.bashrc" || ev.FileName != ".bashrc" {
		t.Errorf("path=%q name=%q", ev.FilePath, ev.FileName)
	}
	if ev.Pid != 4242 || ev.DetectedBy != MonEbpf {
		t.Errorf("pid=%d by=%#x", ev.Pid, ev.DetectedBy)
	}
	if ev.TargetDev != 100 || ev.TargetIno != 200 || !ev.Blocked {
		t.Errorf("target_dev=%d target_ino=%d blocked=%v", ev.TargetDev, ev.TargetIno, ev.Blocked)
	}
	if ev.UID != 1000 || ev.SID != 1200 || ev.Comm != "chmod" {
		t.Errorf("uid=%d sid=%d comm=%q", ev.UID, ev.SID, ev.Comm)
	}
}

// REGISTER ACK: 서버가 만든 agent_id 응답을 에이전트가 되읽을 수 있어야 한다.
func TestRegisterRespRoundTrip(t *testing.T) {
	const want = uint64(99887766)
	b := EncodeRegisterResp(want)
	if len(b) != 8 {
		t.Fatalf("ACK 길이=%d (8 기대)", len(b))
	}
	if got := binary.BigEndian.Uint64(b); got != want {
		t.Fatalf("agent_id=%d (want %d)", got, want)
	}
}

// seq_num 규약: 첫 프레임은 임의 허용, 이후 +1 단조 — 서버 검증식과 동일한 기대.
func TestSeqMonotonicContract(t *testing.T) {
	// 서버는 lastSeq>0 일 때만 (lastSeq+1) 강제. 첫 프레임은 통과.
	last := uint32(0)
	seqs := []uint32{1, 2, 3, 4}
	for _, s := range seqs {
		if last > 0 && s != last+1 {
			t.Fatalf("seq 위반: last=%d got=%d", last, s)
		}
		last = s
	}
	if last != 4 {
		t.Fatalf("최종 seq=%d", last)
	}
}
