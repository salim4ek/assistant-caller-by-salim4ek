// Package api wires HTTP handlers to the store, hub, and JWT issuer.
package api

import (
	"crypto/rand"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"assistant-caller/internal/auth"
	"assistant-caller/internal/models"
	"assistant-caller/internal/store"
	"assistant-caller/internal/ws"
)

type AuthHandler struct {
	DB  *store.DB
	Iss *auth.Issuer
	Hub *ws.Hub
}

func NewAuthHandler(db *store.DB, iss *auth.Issuer, hub *ws.Hub) *AuthHandler {
	return &AuthHandler{DB: db, Iss: iss, Hub: hub}
}

type doctorLoginReq struct {
	FullName string `json:"full_name"`
	Password string `json:"password"`
}

func (h *AuthHandler) DoctorLogin(c *gin.Context) {
	var req doctorLoginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	req.FullName = strings.TrimSpace(req.FullName)
	req.Password = strings.TrimSpace(req.Password)
	if req.FullName == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ФИО и пароль обязательны"})
		return
	}
	d, err := h.DB.FindDoctorByNameAndPassword(req.FullName, req.Password)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "неверное ФИО или пароль, либо заявка ещё не подтверждена"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	tok, err := h.Iss.Issue(d.ID, models.RoleDoctor)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"token":     tok,
		"role":      models.RoleDoctor,
		"full_name": d.FullName,
		"status":    d.Status,
	})
}

type doctorRegisterReq struct {
	FullName string `json:"full_name"`
	Password string `json:"password"`
}

// DoctorRegister — creates a new doctor in 'pending' status. Admin must approve.
func (h *AuthHandler) DoctorRegister(c *gin.Context) {
	var req doctorRegisterReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	req.FullName = strings.TrimSpace(req.FullName)
	req.Password = strings.TrimSpace(req.Password)
	if req.FullName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ФИО обязательно"})
		return
	}
	if len(req.Password) < 4 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "пароль должен быть не короче 4 символов"})
		return
	}
	d, err := h.DB.CreateDoctorPending(req.FullName, req.Password)
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			c.JSON(http.StatusConflict, gin.H{"error": "врач с таким ФИО уже зарегистрирован"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Уведомляем админов о новой заявке (web-push, если админ подписан).
	if h.Hub != nil && h.Hub.PushToAdmins != nil {
		go h.Hub.PushToAdmins("🆕 Новая заявка врача", d.FullName+" — ожидает подтверждения")
	}
	c.JSON(http.StatusCreated, gin.H{
		"id":        d.ID,
		"full_name": d.FullName,
		"status":    d.Status,
		"message":   "Заявка отправлена. Ожидайте подтверждения администратора.",
	})
}

// assistantRegisterReq now only needs the assistant's full name. The unique ID
// is generated server-side and returned in the response (Discord-style).
type assistantRegisterReq struct {
	FullName string `json:"full_name"`
}

func (h *AuthHandler) AssistantRegister(c *gin.Context) {
	var req assistantRegisterReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	req.FullName = strings.TrimSpace(req.FullName)
	if req.FullName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ФИО обязательно"})
		return
	}

	// Generate a unique ID with collision retry.
	const maxTries = 8
	var (
		uid string
		err error
	)
	for i := 0; i < maxTries; i++ {
		uid, err = generateAssistantID()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "id gen: " + err.Error()})
			return
		}
		_, ferr := h.DB.FindAssistant(uid)
		if errors.Is(ferr, store.ErrNotFound) {
			break // unique
		}
		if ferr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": ferr.Error()})
			return
		}
		uid = "" // collision; retry
	}
	if uid == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "не удалось сгенерировать уникальный ID, попробуйте ещё раз"})
		return
	}

	a, err := h.DB.CreateAssistant(uid, req.FullName)
	if err != nil {
		// A concurrent registration may have won the race; surface it.
		if errors.Is(err, store.ErrConflict) {
			c.JSON(http.StatusConflict, gin.H{"error": "ID занят, попробуйте ещё раз"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if h.Hub != nil {
		if rerr := h.Hub.ReloadAssistants(h.DB); rerr != nil {
			log.Printf("[WARN] hub reload after register: %v", rerr)
		}
	}
	tok, err := h.Iss.Issue(a.ID, models.RoleAssistant)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"token":     tok,
		"role":      models.RoleAssistant,
		"unique_id": a.UniqueID,
		"full_name": a.FullName,
	})
}

type assistantLoginReq struct {
	Identifier string `json:"identifier"` // ID или ФИО/кабинет
	// legacy-поля (старые клиенты)
	UniqueID string `json:"unique_id"`
	FullName string `json:"full_name"`
}

func (h *AuthHandler) AssistantLogin(c *gin.Context) {
	var req assistantLoginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	ident := strings.TrimSpace(req.Identifier)
	if ident == "" {
		ident = strings.TrimSpace(req.UniqueID)
	}
	if ident == "" {
		ident = strings.TrimSpace(req.FullName)
	}
	if ident == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "введите ID или ФИО/кабинет"})
		return
	}

	// 1) пробуем как уникальный ID; 2) как ФИО/кабинет — с проверкой регистрации.
	a, err := h.DB.FindAssistant(strings.ToUpper(ident))
	if errors.Is(err, store.ErrNotFound) {
		a, err = h.DB.FindAssistantByName(ident)
		if errors.Is(err, store.ErrConflict) {
			c.JSON(http.StatusConflict, gin.H{"error": "несколько ассистентов с таким именем — войдите по уникальному ID"})
			return
		}
	}
	if errors.Is(err, store.ErrNotFound) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "не найдено в системе. Проверьте ID или ФИО/кабинет, либо зарегистрируйтесь."})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	tok, err := h.Iss.Issue(a.ID, models.RoleAssistant)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"token":     tok,
		"role":      models.RoleAssistant,
		"unique_id": a.UniqueID,
		"full_name": a.FullName,
	})
}

// idAlphabet excludes confusing characters: 0/O/1/I/L.
const idAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

func generateAssistantID() (string, error) {
	const idLen = 6
	buf := make([]byte, idLen)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	for i, b := range buf {
		buf[i] = idAlphabet[int(b)%len(idAlphabet)]
	}
	return "NN-" + string(buf), nil
}