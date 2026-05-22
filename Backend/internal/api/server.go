package api

import (
	"log"

	"github.com/KN-IG/KN-IG/Backend/internal"
	"github.com/KN-IG/KN-IG/Backend/internal/report"
	"github.com/gin-gonic/gin"
)

// Server : REST API 서버
type Server struct {
	router       *gin.Engine
	agentStore   internal.AgentStore
	eventStore   internal.EventStore
	alertStore   internal.AlertStore
	publisher    internal.EventPublisher
	auth         *Auth          // 콘솔 PIN 인증 (항상 활성)
	reportClient *report.Client // nil이면 리포트 생성 비활성 (LLM_SERVER_URL 미설정)
}

// NewServer : 서버 생성. /auth/* 등록 + /api/* 콘솔 PIN 인증(Bearer).
// reportClient가 nil이면 POST /api/reports/summary는 503을 반환한다.
func NewServer(
	agentStore internal.AgentStore,
	eventStore internal.EventStore,
	alertStore internal.AlertStore,
	publisher internal.EventPublisher,
	auth *Auth,
	reportClient *report.Client,
) *Server {
	router := gin.Default()
	router.Use(corsMiddleware())

	s := &Server{
		router:       router,
		agentStore:   agentStore,
		eventStore:   eventStore,
		alertStore:   alertStore,
		publisher:    publisher,
		auth:         auth,
		reportClient: reportClient,
	}

	s.registerRoutes()

	return s
}

// registerRoutes : API 엔드포인트 등록
func (s *Server) registerRoutes() {
	// 콘솔 PIN 인증 endpoint (자체적으로 인증 불필요)
	authGrp := s.router.Group("/auth")
	authGrp.GET("/status", s.auth.Status)
	authGrp.POST("/setup", s.auth.Setup)
	authGrp.POST("/login", s.auth.Login)

	api := s.router.Group("/api")
	api.Use(s.auth.Authorize)

	// Agent API
	api.GET("/agents", s.handleListAgents)
	api.GET("/agents/:id", s.handleGetAgent)
	api.DELETE("/agents/:id", s.handleDeleteAgent)
	api.PUT("/agents/:id/status", s.handleUpdateStatus)

	// Event API
	api.GET("/events", s.handleQueryEvents)
	api.GET("/events/stream", s.handleSSE)

	// Alert API
	api.GET("/alerts", s.handleListAlerts)
	api.PATCH("/alerts/:id/resolve", s.handleResolveAlert)

	// Report API (LLM 서버 프록시)
	api.POST("/reports/summary", s.handleGenerateSummaryReport)
}

// corsMiddleware : Tauri 콘솔(별 origin)이 직접 호출 가능하도록 허용.
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

// Start : 서버 시작
func (s *Server) Start(addr string) error {
	log.Printf("HTTP 서버 시작: %s", addr)
	return s.router.Run(addr)
}
