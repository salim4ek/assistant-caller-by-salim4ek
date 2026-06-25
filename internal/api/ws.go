package api

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"assistant-caller/internal/auth"
	"assistant-caller/internal/store"
	"assistant-caller/internal/ws"
)

type WSHandler struct {
	Hub *ws.Hub
	DB  *store.DB
	Iss *auth.Issuer
}

func NewWSHandler(hub *ws.Hub, db *store.DB, iss *auth.Issuer) *WSHandler {
	return &WSHandler{Hub: hub, DB: db, Iss: iss}
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true }, // local + same-origin only
}

func (h *WSHandler) Handle(c *gin.Context) {
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no claims"})
		return
	}
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[WARN] ws upgrade failed: %v", err)
		return
	}

	uid := ""
	fullName := ""
	switch cl.Role {
	case "doctor":
		d, err := h.DB.ListDoctors()
		if err == nil {
			for _, dd := range d {
				if dd.ID == cl.UserID {
					fullName = dd.FullName
					break
				}
			}
		}
	case "assistant":
		a, err := h.DB.FindAssistantByID(cl.UserID)
		if err == nil {
			uid = a.UniqueID
			fullName = a.FullName
		}
	default:
		// Admin doesn't have a dedicated WS endpoint in MVP.
		_ = conn.Close()
		return
	}

	client := ws.NewClient(h.Hub, conn, cl.UserID, cl.Role, uid, fullName)
	go client.Run()
}
