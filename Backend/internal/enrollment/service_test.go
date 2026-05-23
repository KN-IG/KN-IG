package enrollment

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/KN-IG/KN-IG/Backend/internal"
)

func TestEnrollRejectsPreBoundAgentMismatchBeforeClaim(t *testing.T) {
	enrollments := &recordingEnrollmentStore{}
	svc := NewService(enrollments, nil, nil)

	_, err := svc.Enroll(context.Background(), "enroll-1", "pre-bound-agent", Request{
		Hostname:    "agent-host",
		IP:          "192.0.2.10",
		OS:          "Linux",
		MonitorType: 3,
	})
	if !errors.Is(err, internal.ErrEnrollmentAgentMismatch) {
		t.Fatalf("Enroll error = %v, want %v", err, internal.ErrEnrollmentAgentMismatch)
	}
	if enrollments.claimed {
		t.Fatal("enrollment was claimed before pre-bound agent_id validation")
	}
}

type recordingEnrollmentStore struct {
	claimed bool
}

func (s *recordingEnrollmentStore) CreateEnrollment(context.Context, internal.Enrollment) error {
	return nil
}

func (s *recordingEnrollmentStore) GetPendingEnrollment(context.Context, string, time.Time) (internal.Enrollment, error) {
	return internal.Enrollment{}, nil
}

func (s *recordingEnrollmentStore) ClaimEnrollment(context.Context, string, string, time.Time) error {
	s.claimed = true
	return nil
}

func (s *recordingEnrollmentStore) ReleaseEnrollmentClaim(context.Context, string, string, bool) error {
	return nil
}

func (s *recordingEnrollmentStore) FinalizeEnrollmentIssue(context.Context, string, string, internal.RegisterPayload, internal.AgentCertificate, time.Time) error {
	return nil
}

func (s *recordingEnrollmentStore) MarkEnrollmentUsed(context.Context, string, string, time.Time) error {
	return nil
}
