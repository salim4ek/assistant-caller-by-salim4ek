package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"assistant-caller/internal/auth"
	"assistant-caller/internal/store"
)

type PushHandler struct {
	DB          *store.DB
	VapidPublic string
}

func NewPushHandler(db *store.DB, vapidPublic string) *PushHandler {
	return &PushHandler{DB: db, VapidPublic: vapidPublic}
}

// GET /api/push/vapid-public — публичный VAPID-ключ для подписки в браузере.
func (h *PushHandler) GetVapidPublic(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"public_key": h.VapidPublic,
		"enabled":    h.VapidPublic != "",
	})
}

type subscribeReq struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// POST /api/push/subscribe — ассистент сохраняет свою push-подписку.
func (h *PushHandler) Subscribe(c *gin.Context) {
	cl := auth.ClaimsFrom(c)
	if cl == nil || (cl.Role != "assistant" && cl.Role != "doctor" && cl.Role != "admin") {
		c.JSON(http.StatusForbidden, gin.H{"error": "только врач, ассистент или админ"})
		return
	}
	var req subscribeReq
	if err := c.ShouldBindJSON(&req); err != nil ||
		req.Endpoint == "" || req.Keys.P256dh == "" || req.Keys.Auth == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subscription"})
		return
	}
	if err := h.DB.SavePushSub(cl.Role, cl.UserID, req.Endpoint, req.Keys.P256dh, req.Keys.Auth); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// POST /api/push/unsubscribe — удалить подписку (пользователь выключил уведомления).
func (h *PushHandler) Unsubscribe(c *gin.Context) {
	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Endpoint == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "endpoint required"})
		return
	}
	if err := h.DB.DeletePushSubscription(req.Endpoint); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type pendingDoctorSubReq struct {
	FullName string `json:"full_name"`
	Password string `json:"password"`
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// POST /auth/doctor/pending-subscribe — врач «на модерации» подписывается на push,
// чтобы получить уведомление об одобрении заявки. Авторизация — по его же ФИО+паролю
// (полноценный токен до одобрения НЕ выдаём, чтобы не давать лишних прав).
func (h *PushHandler) PendingDoctorSubscribe(c *gin.Context) {
	var req pendingDoctorSubReq
	if err := c.ShouldBindJSON(&req); err != nil ||
		req.Endpoint == "" || req.Keys.P256dh == "" || req.Keys.Auth == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subscription"})
		return
	}
	d, err := h.DB.FindDoctorByNameAndPasswordAnyStatus(req.FullName, req.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "неверное ФИО или пароль"})
		return
	}
	if d.Status == store.DoctorStatusApproved {
		c.JSON(http.StatusOK, gin.H{"status": "approved"})
		return
	}
	if d.Status == store.DoctorStatusRejected {
		c.JSON(http.StatusForbidden, gin.H{"status": "rejected", "error": "заявка отклонена"})
		return
	}
	if err := h.DB.SavePushSub("doctor", d.ID, req.Endpoint, req.Keys.P256dh, req.Keys.Auth); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "pending", "ok": true})
}

// GET /api/push/holders — кто имеет push-подписку (установлено приложение → получит
// уведомление даже офлайн). Используется для значка-телефона в списках.
func (h *PushHandler) Holders(c *gin.Context) {
	asst, _ := h.DB.AssistantUIDsWithPush()
	docs, _ := h.DB.DoctorIDsWithPush()
	if asst == nil {
		asst = []string{}
	}
	if docs == nil {
		docs = []int64{}
	}
	c.JSON(http.StatusOK, gin.H{"assistants": asst, "doctors": docs})
}
