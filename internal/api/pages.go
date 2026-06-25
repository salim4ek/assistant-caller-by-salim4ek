package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Health is the only HTML-returning handler still in use (for Docker healthcheck).
// The SPA is served via the NoRoute fallback in main.go.
type PageHandler struct{}

func NewPageHandler() *PageHandler { return &PageHandler{} }

func (h *PageHandler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
