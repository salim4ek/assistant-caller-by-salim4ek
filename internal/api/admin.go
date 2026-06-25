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

type AdminHandler struct {
	DB  *store.DB
	Iss *auth.Issuer
	Hub *ws.Hub
}

func NewAdminHandler(db *store.DB, iss *auth.Issuer, hub *ws.Hub) *AdminHandler {
	return &AdminHandler{DB: db, Iss: iss, Hub: hub}
}

type adminLoginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (h *AdminHandler) Login(c *gin.Context) {
	var req adminLoginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "логин и пароль обязательны"})
		return
	}
	a, err := h.DB.VerifyAdminPassword(req.Username, req.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "неверный логин или пароль"})
		return
	}
	tok, err := h.Iss.Issue(a.ID, models.RoleAdmin)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": tok, "role": models.RoleAdmin, "username": a.Username})
}

func (h *AdminHandler) ListWhitelist(c *gin.Context) {
	list, err := h.DB.ListWhitelist()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

type whitelistAddReq struct {
	Email string `json:"email"`
}

func (h *AdminHandler) AddWhitelist(c *gin.Context) {
	var req whitelistAddReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	w, err := h.DB.AddToWhitelist(req.Email)
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			c.JSON(http.StatusConflict, gin.H{"error": "email уже в вайтлисте"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, w)
}

func (h *AdminHandler) RemoveWhitelist(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if err := h.DB.RemoveFromWhitelist(id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *AdminHandler) ListDoctors(c *gin.Context) {
	list, err := h.DB.ListDoctors()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

func (h *AdminHandler) ListDoctorsPending(c *gin.Context) {
	list, err := h.DB.ListDoctorsByStatus(store.DoctorStatusPending)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

func (h *AdminHandler) ApproveDoctor(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	d, err := h.DB.ApproveDoctor(id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Уведомляем врача об одобрении через web-push (если он подписался на экране ожидания).
	if h.Hub != nil && h.Hub.PushToDoctor != nil {
		go h.Hub.PushToDoctor(d.ID, "✅ Заявка одобрена", "Вы можете войти в приложение «NN+ Вызов»")
	}
	c.JSON(http.StatusOK, d)
}

func (h *AdminHandler) RejectDoctor(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	d, err := h.DB.RejectDoctor(id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, d)
}

func (h *AdminHandler) DeleteDoctor(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if err := h.DB.DeleteDoctor(id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *AdminHandler) DeleteAssistant(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if err := h.DB.DeleteAssistant(id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *AdminHandler) ListAssistants(c *gin.Context) {
	list, err := h.DB.ListAssistants()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

func (h *AdminHandler) Online(c *gin.Context) {
	as := h.Hub.PresenceSnapshot()
	online := make([]gin.H, 0, len(as))
	for _, a := range as {
		if a.Online {
			online = append(online, gin.H{
				"unique_id": a.UniqueID,
				"full_name": a.FullName,
			})
		}
	}
	// Онлайн-врачи: пересекаем подключённых по роли doctor с их ФИО из БД.
	docIDs := h.Hub.OnlineDoctorIDs()
	doctorsOnline := make([]gin.H, 0, len(docIDs))
	if len(docIDs) > 0 {
		idset := make(map[int64]bool, len(docIDs))
		for _, id := range docIDs {
			idset[id] = true
		}
		if all, err := h.DB.ListDoctors(); err == nil {
			for _, d := range all {
				if idset[d.ID] {
					doctorsOnline = append(doctorsOnline, gin.H{"id": d.ID, "full_name": d.FullName})
				}
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"online": online, "online_count": len(online),
		"doctors_online": doctorsOnline, "doctors_online_count": len(doctorsOnline),
	})
}

// ReloadAssistants forces a fresh fetch from DB (useful after manual SQL edits).
func (h *AdminHandler) ReloadAssistants(c *gin.Context) {
	if err := h.Hub.ReloadAssistants(h.DB); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "reloaded"})
}

// LookupAssistantByID returns the assistant profile for a given unique_id.
// Available to authenticated doctors — they use this to verify an ID and
// auto-fill the assistant's full name before calling.
func (h *AdminHandler) LookupAssistantByID(c *gin.Context) {
	uid := strings.ToUpper(strings.TrimSpace(c.Query("unique_id")))
	if uid == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unique_id обязателен"})
		return
	}
	a, err := h.DB.FindAssistant(uid)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "ассистент с таким ID не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"unique_id": a.UniqueID,
		"full_name": a.FullName,
		"online":    h.Hub.IsAssistantOnline(a.UniqueID),
	})
}

func (h *AdminHandler) ListAdminUsers(c *gin.Context) {
	list, err := h.DB.ListAdmins()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

type adminCreateReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (h *AdminHandler) CreateAdmin(c *gin.Context) {
	var req adminCreateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Password = req.Password
	if req.Username == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "логин и пароль обязательны"})
		return
	}
	if len(req.Password) < 6 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "пароль должен быть не короче 6 символов"})
		return
	}
	a, err := h.DB.CreateAdmin(req.Username, req.Password)
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			c.JSON(http.StatusConflict, gin.H{"error": "админ с таким логином уже существует"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, a)
}

func (h *AdminHandler) DeleteAdmin(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	// Prevent self-delete: the current admin must not remove themselves.
	cl := auth.ClaimsFrom(c)
	if cl != nil && cl.UserID == id {
		c.JSON(http.StatusBadRequest, gin.H{"error": "нельзя удалить самого себя"})
		return
	}
	if err := h.DB.DeleteAdmin(id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

type testCallReq struct {
	UniqueID string `json:"unique_id"`
	Message  string `json:"message"`
}

// POST /admin/test-call  {unique_id, message}
// Lets an admin ring an assistant for testing without switching to a doctor account.
func (h *AdminHandler) TestCall(c *gin.Context) {
	var req testCallReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	req.UniqueID = strings.ToUpper(strings.TrimSpace(req.UniqueID))
	if req.UniqueID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unique_id обязателен"})
		return
	}
	if strings.TrimSpace(req.Message) == "" {
		req.Message = "Тестовый вызов из админ-панели"
	}
	if _, err := h.DB.FindAssistant(req.UniqueID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ассистент с таким ID не найден"})
		return
	}
	callID, delivered := h.Hub.TestCall(req.UniqueID, "Админ (тест)", req.Message)
	c.JSON(http.StatusOK, gin.H{"call_id": callID, "delivered": delivered})
}

type broadcastReq struct {
	Message string `json:"message"`
}

// POST /admin/broadcast {message} — рассылка-уведомление ВСЕМ подключённым
// пользователям (врачам и ассистентам).
func (h *AdminHandler) Broadcast(c *gin.Context) {
	var req broadcastReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	msg := strings.TrimSpace(req.Message)
	if msg == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "пустое сообщение"})
		return
	}
	n := h.Hub.BroadcastToAll(msg, "Администрация")
	c.JSON(http.StatusOK, gin.H{"delivered": n})
}
