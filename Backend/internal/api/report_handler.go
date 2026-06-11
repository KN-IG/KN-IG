package api

import (
	"io"
	"net/http"
	"time"

	"github.com/KN-IG/KN-IG/Backend/internal"
	"github.com/gin-gonic/gin"
)

// reportEventLimit : 리포트 1건당 LLM 서버로 보낼 이벤트 상한 (토큰/페이로드 보호)
const reportEventLimit = 5000

// collectReportPayload : from/to 기간 기준으로 events/prevEvents/alerts/agents를 모아
// LLM 서버 전달용 payload를 만든다. 오류 시 c에 응답하고 false를 반환한다.
// from/to는 RFC3339 쿼리 파라미터이며, 미지정 시 최근 7일을 사용한다.
func (s *Server) collectReportPayload(c *gin.Context) (gin.H, bool) {
	to := time.Now()
	from := to.AddDate(0, 0, -7)

	if v := c.Query("from"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid from format, use RFC3339"})
			return nil, false
		}
		from = t
	}
	if v := c.Query("to"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid to format, use RFC3339"})
			return nil, false
		}
		to = t
	}

	dur := to.Sub(from)
	ctx := c.Request.Context()

	events, err := s.eventStore.QueryEvents(ctx, internal.EventFilter{From: from, To: to, Limit: reportEventLimit})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return nil, false
	}
	// 직전 동일 길이 구간 — KPI 증감/비교선 계산용
	prevEvents, err := s.eventStore.QueryEvents(ctx, internal.EventFilter{From: from.Add(-dur), To: from, Limit: reportEventLimit})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return nil, false
	}
	alerts, err := s.alertStore.ListAlerts(ctx, internal.AlertFilter{From: from, To: to, Limit: reportEventLimit})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return nil, false
	}
	agents, err := s.agentStore.ListAgents(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return nil, false
	}

	// 인시던트 PID Chain 표시용 — 계보가 있는 이벤트의 프로세스 체인을 일괄 로드해 부착.
	// (LLM 서버는 이 Chain을 받아 incidents[].chain으로 펼친다)
	var chainIDs []int64
	for _, e := range events {
		if e.ChainDepth > 0 {
			chainIDs = append(chainIDs, e.ID)
		}
	}
	if len(chainIDs) > 0 {
		chains, err := s.eventStore.LoadProcessChains(ctx, chainIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return nil, false
		}
		for i := range events {
			if ch, ok := chains[events[i].ID]; ok {
				events[i].Chain = ch
			}
		}
	}

	return gin.H{
		"range":      gin.H{"from": from.Format(time.RFC3339), "to": to.Format(time.RFC3339)},
		"agents":     agents,
		"events":     events,
		"prevEvents": prevEvents,
		"alerts":     alerts,
	}, true
}

// handleGenerateSummaryReport : POST /api/reports/summary
//
// 누적 file_events/alerts/agents를 기간 기준으로 모아 LLM 서버로 전달하고,
// LLM 서버가 만든 report 페이지용 DATA(JSON)를 그대로 반환한다.
func (s *Server) handleGenerateSummaryReport(c *gin.Context) {
	if s.reportClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "report service not configured (LLM_SERVER_URL unset)"})
		return
	}
	payload, ok := s.collectReportPayload(c)
	if !ok {
		return
	}

	data, err := s.reportClient.GenerateSummary(c.Request.Context(), payload)
	if err != nil {
		// LLM 서버 미가동/오류 시 503 — 프론트는 mock으로 폴백한다.
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "report generation failed: " + err.Error()})
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", data)
}

// handleGenerateSummaryReportStream : POST /api/reports/summary/stream
//
// LLM 스트리밍 엔드포인트(SSE: skeleton/token/patch/done)를 프론트로 그대로 중계한다.
// 본문을 버퍼링 없이 흘려보내 토큰 단위 실시간 렌더가 가능하게 한다.
func (s *Server) handleGenerateSummaryReportStream(c *gin.Context) {
	if s.reportClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "report service not configured (LLM_SERVER_URL unset)"})
		return
	}
	payload, ok := s.collectReportPayload(c)
	if !ok {
		return
	}

	body, err := s.reportClient.GenerateSummaryStream(c.Request.Context(), payload)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "report stream failed: " + err.Error()})
		return
	}
	defer body.Close()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no") // nginx 등 프록시 버퍼링 비활성

	buf := make([]byte, 4096)
	c.Stream(func(w io.Writer) bool {
		n, rerr := body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return false // 클라이언트 연결 종료
			}
		}
		return rerr == nil
	})
}
