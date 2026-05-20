package store

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/KN-IG/KN-IG/Backend/internal"
)

// MySQLEnrollmentStore : EnrollmentStore 인터페이스의 MySQL 구현체
type MySQLEnrollmentStore struct {
	db *sql.DB
}

// NewMySQLEnrollmentStore : MySQLEnrollmentStore 생성
func NewMySQLEnrollmentStore(db *sql.DB) internal.EnrollmentStore {
	return &MySQLEnrollmentStore{db: db}
}

// CreateEnrollment : 신규 Agent 최초 등록 XOR key metadata 저장
func (s *MySQLEnrollmentStore) CreateEnrollment(ctx context.Context, e internal.Enrollment) error {
	query := `
		INSERT INTO agent_enrollments
			(enrollment_id, agent_id, secret_hash, key_ciphertext, key_nonce, status, expires_at, created_at)
		VALUES (?, NULLIF(?, ''), ?, ?, ?, 'pending', ?, NOW())`
	_, err := s.db.ExecContext(ctx, query, e.EnrollmentID, e.AgentID, e.SecretHash, e.KeyCiphertext, e.KeyNonce, e.ExpiresAt)
	return err
}

// GetPendingEnrollment : XOR bootstrap 세션 시작 전 pending enrollment 조회
func (s *MySQLEnrollmentStore) GetPendingEnrollment(ctx context.Context, enrollmentID string, now time.Time) (internal.Enrollment, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return internal.Enrollment{}, err
	}
	defer tx.Rollback()

	var row internal.Enrollment
	var storedAgentID sql.NullString
	query := `
		SELECT agent_id, secret_hash, key_ciphertext, key_nonce, status, expires_at, created_at
		FROM agent_enrollments
		WHERE enrollment_id = ?
		FOR UPDATE`
	err = tx.QueryRowContext(ctx, query, enrollmentID).Scan(
		&storedAgentID,
		&row.SecretHash,
		&row.KeyCiphertext,
		&row.KeyNonce,
		&row.Status,
		&row.ExpiresAt,
		&row.CreatedAt,
	)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return internal.Enrollment{}, internal.ErrEnrollmentNotFound
	case err != nil:
		return internal.Enrollment{}, err
	}
	row.EnrollmentID = enrollmentID
	if storedAgentID.Valid {
		row.AgentID = storedAgentID.String
	}

	switch row.Status {
	case "pending":
	case "issuing", "used", "issued":
		return internal.Enrollment{}, internal.ErrEnrollmentUsed
	case "revoked":
		return internal.Enrollment{}, internal.ErrEnrollmentRevoked
	default:
		return internal.Enrollment{}, internal.ErrInvalidInput
	}

	if !now.Before(row.ExpiresAt) {
		return internal.Enrollment{}, internal.ErrEnrollmentExpired
	}

	update := `
		UPDATE agent_enrollments
		SET attempt_count = attempt_count + 1, last_attempt_at = ?
		WHERE enrollment_id = ?`
	if _, err := tx.ExecContext(ctx, update, now, enrollmentID); err != nil {
		return internal.Enrollment{}, err
	}
	if err := tx.Commit(); err != nil {
		return internal.Enrollment{}, err
	}
	return row, nil
}

// ClaimEnrollment : pending enrollment를 issuing으로 원자적으로 전환해 동시 발급을 막는다.
func (s *MySQLEnrollmentStore) ClaimEnrollment(ctx context.Context, enrollmentID string, agentID string, now time.Time) error {
	query := `
		UPDATE agent_enrollments
		SET status = 'issuing', agent_id = ?
		WHERE enrollment_id = ? AND status = 'pending' AND expires_at > ?`
	res, err := s.db.ExecContext(ctx, query, agentID, enrollmentID, now)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return internal.ErrEnrollmentUsed
	}
	return nil
}

// ReleaseEnrollmentClaim : 발급 side effect 실패 시 issuing claim을 pending으로 되돌린다.
func (s *MySQLEnrollmentStore) ReleaseEnrollmentClaim(ctx context.Context, enrollmentID string, agentID string, keepAgentID bool) error {
	query := `
		UPDATE agent_enrollments
		SET status = 'pending', agent_id = NULL
		WHERE enrollment_id = ? AND status = 'issuing' AND agent_id = ?`
	if keepAgentID {
		query = `
			UPDATE agent_enrollments
			SET status = 'pending'
			WHERE enrollment_id = ? AND status = 'issuing' AND agent_id = ?`
	}
	_, err := s.db.ExecContext(ctx, query, enrollmentID, agentID)
	return err
}

// FinalizeEnrollmentIssue : Agent row, cert rotation, enrollment issued 상태 전환을 하나의 트랜잭션으로 확정한다.
func (s *MySQLEnrollmentStore) FinalizeEnrollmentIssue(ctx context.Context, enrollmentID string, agentID string, payload internal.RegisterPayload, cert internal.AgentCertificate, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := ensureAgentOfflineTx(ctx, tx, agentID, payload); err != nil {
		return err
	}
	if err := rotateActiveCertificateTx(ctx, tx, agentID, cert); err != nil {
		return err
	}

	query := `
		UPDATE agent_enrollments
		SET status = 'issued', issued_at = ?, agent_id = ?
		WHERE enrollment_id = ? AND status = 'issuing' AND agent_id = ? AND expires_at > ?`
	res, err := tx.ExecContext(ctx, query, now, agentID, enrollmentID, agentID, now)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return internal.ErrEnrollmentUsed
	}

	return tx.Commit()
}

// MarkEnrollmentUsed : Agent가 protected ACK를 보낸 뒤 완료 처리한다.
func (s *MySQLEnrollmentStore) MarkEnrollmentUsed(ctx context.Context, enrollmentID string, agentID string, now time.Time) error {
	query := `
		UPDATE agent_enrollments
		SET status = 'used', used_at = ?, agent_id = ?
		WHERE enrollment_id = ? AND status = 'issued' AND agent_id = ?`
	res, err := s.db.ExecContext(ctx, query, now, agentID, enrollmentID, agentID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return internal.ErrEnrollmentUsed
	}
	return nil
}
