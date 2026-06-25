package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"assistant-caller/internal/auth"
	"assistant-caller/internal/models"
	"assistant-caller/internal/store"
	"assistant-caller/internal/ws"
)

// DoctorHandler serves authenticated doctor's personal-list endpoints.
type DoctorHandler struct {
	DB  *store.DB
	Hub *ws.Hub
}

func NewDoctorHandler(db *store.DB, hub *ws.Hub) *DoctorHandler {
	return &DoctorHandler{DB: db, Hub: hub}
}

// GET /api/doctor/assistants
func (h *DoctorHandler) ListAssistants(c *gin.Context) {
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no claims"})
		return
	}
	list, err := h.DB.ListDoctorAssistants(cl.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Decorate with online status from the hub.
	type item struct {
		models.DoctorAssistantView
		Online bool `json:"online"`
	}
	out := make([]item, 0, len(list))
	for _, v := range list {
		out = append(out, item{DoctorAssistantView: v, Online: h.Hub.IsAssistantOnline(v.UniqueID)})
	}
	c.JSON(http.StatusOK, out)
}

type addAssistantReq struct {
	UniqueID string `json:"unique_id"`
}

// POST /api/doctor/assistants  {unique_id}
func (h *DoctorHandler) AddAssistant(c *gin.Context) {
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no claims"})
		return
	}
	var req addAssistantReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	req.UniqueID = strings.ToUpper(strings.TrimSpace(req.UniqueID))
	if req.UniqueID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unique_id обязателен"})
		return
	}
	link, err := h.DB.AddAssistantToDoctor(cl.UserID, req.UniqueID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "ассистент с таким ID не найден"})
			return
		}
		if errors.Is(err, store.ErrConflict) {
			c.JSON(http.StatusConflict, gin.H{"error": "уже добавлен"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Return the full view (with name etc.)
	views, _ := h.DB.ListDoctorAssistants(cl.UserID)
	for _, v := range views {
		if v.ID == link.ID {
			c.JSON(http.StatusCreated, gin.H{
				"id":           v.ID,
				"assistant_id": v.AssistantID,
				"unique_id":    v.UniqueID,
				"full_name":    v.FullName,
				"online":       h.Hub.IsAssistantOnline(v.UniqueID),
				"created_at":   v.CreatedAt,
			})
			return
		}
	}
	c.JSON(http.StatusCreated, link)
}

// DELETE /api/doctor/assistants/:id
func (h *DoctorHandler) RemoveAssistant(c *gin.Context) {
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no claims"})
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if err := h.DB.RemoveDoctorAssistant(cl.UserID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// GET /api/doctor/all-assistants — все зарегистрированные ассистенты (поиск/добавление).
func (h *DoctorHandler) AllAssistants(c *gin.Context) {
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no claims"})
		return
	}
	all, err := h.DB.ListAssistants()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	mine, _ := h.DB.ListDoctorAssistants(cl.UserID)
	added := map[int64]bool{}
	for _, m := range mine {
		added[m.AssistantID] = true
	}
	type item struct {
		ID       int64  `json:"id"`
		UniqueID string `json:"unique_id"`
		FullName string `json:"full_name"`
		Online   bool   `json:"online"`
		Added    bool   `json:"added"`
	}
	out := make([]item, 0, len(all))
	for _, a := range all {
		out = append(out, item{a.ID, a.UniqueID, a.FullName, h.Hub.IsAssistantOnline(a.UniqueID), added[a.ID]})
	}
	c.JSON(http.StatusOK, out)
}

// GET /api/assistant/my-doctors — врачи, которые добавили этого ассистента в свой список.
func (h *DoctorHandler) MyDoctors(c *gin.Context) {
	cl := auth.ClaimsFrom(c)
	if cl == nil || cl.Role != "assistant" {
		c.JSON(http.StatusForbidden, gin.H{"error": "только ассистент"})
		return
	}
	docs, err := h.DB.ListDoctorsForAssistant(cl.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	type item struct {
		ID       int64  `json:"id"`
		FullName string `json:"full_name"`
		Online   bool   `json:"online"`
	}
	out := make([]item, 0, len(docs))
	for _, d := range docs {
		out = append(out, item{d.ID, d.FullName, h.Hub.IsUserOnline(d.ID)})
	}
	c.JSON(http.StatusOK, out)
}

// GET /api/me — returns the current user's basic profile (for UI).
func (h *DoctorHandler) Me(c *gin.Context) {
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no claims"})
		return
	}
	switch cl.Role {
	case "doctor":
		// Find doctor by id (cheap: query by id)
		var email, name string
		err := h.DB.QueryRow(`SELECT COALESCE(email, ''), full_name FROM doctors WHERE id = ?`, cl.UserID).Scan(&email, &name)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"role": "doctor", "email": email, "full_name": name})
	case "assistant":
		a, err := h.DB.FindAssistantByID(cl.UserID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"role":      "assistant",
			"unique_id": a.UniqueID,
			"full_name": a.FullName,
			"online":    h.Hub.IsAssistantOnline(a.UniqueID),
		})
	case "admin":
		var name string
		err := h.DB.QueryRow(`SELECT username FROM admins WHERE id = ?`, cl.UserID).Scan(&name)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"role": "admin", "username": name})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown role"})
	}
}
