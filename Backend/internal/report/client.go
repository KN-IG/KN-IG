// Package report는 LLM 서버로 집계 데이터를 전달해 리포트 DATA를 받아오는 클라이언트다.
package report

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client : LLM 서버 HTTP 클라이언트
type Client struct {
	baseURL string
	http    *http.Client
}

// NewClient : LLM_SERVER_URL 기반 클라이언트 생성
func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: 60 * time.Second},
	}
}

// GenerateSummary : 집계 payload를 LLM 서버로 POST하고 report DATA(JSON)를 그대로 반환한다.
func (c *Client) GenerateSummary(ctx context.Context, payload any) ([]byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/reports/summary", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("llm server returned %d: %s", resp.StatusCode, string(data))
	}
	return data, nil
}
