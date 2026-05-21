package api

import (
	"net/http"
	"time"

	"github.com/KN-IG/KN-IG/Backend/internal"
	"github.com/gin-gonic/gin"
)

// reportEventLimit : 리포트 1건당 LLM 서버로 보낼 이벤트 상한 (토큰/페이로드 보호)
const reportEventLimit = 5000

// handleGenerateSummaryReport : POST /api/reports/summary
//
// 누적 file_events/alerts/agents를 기간 기준으로 모아 LLM 서버로 전달하고,
// LLM 서버가 만든 report 페이지용 DATA(JSON)를 그대로 반환한다.
// from/to는 RFC3339 쿼리 파라미터이며, 미지정 시 최근 7일을 사용한다.
func (s *Server) handleGenerateSummaryReport(c *gin.Context) {
	if s.reportClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "report service not configured (LLM_SERVER_URL unset)"})
		return
	}

	to := time.Now()
	from := to.AddDate(0, 0, -7)

	if v := c.Query("from"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid from format, use RFC3339"})
			return
		}
		from = t
	}
	if v := c.Query("to"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid to format, use RFC3339"})
			return
		}
		to = t
	}

	dur := to.Sub(from)
	ctx := c.Request.Context()

	events, err := s.eventStore.QueryEvents(ctx, internal.EventFilter{From: from, To: to, Limit: reportEventLimit})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 직전 동일 길이 구간 — KPI 증감/비교선 계산용
	prevEvents, err := s.eventStore.QueryEvents(ctx, internal.EventFilter{From: from.Add(-dur), To: from, Limit: reportEventLimit})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	alerts, err := s.alertStore.ListAlerts(ctx, internal.AlertFilter{From: from, Limit: reportEventLimit})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	agents, err := s.agentStore.ListAgents(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	payload := gin.H{
		"range":      gin.H{"from": from.Format(time.RFC3339), "to": to.Format(time.RFC3339)},
		"agents":     agents,
		"events":     events,
		"prevEvents": prevEvents,
		"alerts":     alerts,
	}

	data, err := s.reportClient.GenerateSummary(ctx, payload)
	if err != nil {
		// LLM 서버 미가동/오류 시 503 — 프론트는 mock으로 폴백한다.
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "report generation failed: " + err.Error()})
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", data)
}
