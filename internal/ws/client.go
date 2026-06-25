package ws

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 4096
	sendBufferSize = 64
)

// Client wraps a single WebSocket connection and its metadata.
type Client struct {
	conn     *websocket.Conn
	hub      *Hub
	send     chan []byte
	UserID   int64
	Role     string
	UniqueID string // only for assistants
	FullName string // human-friendly display name
}

func NewClient(hub *Hub, conn *websocket.Conn, userID int64, role, uid, fullName string) *Client {
	return &Client{
		conn:     conn,
		hub:      hub,
		send:     make(chan []byte, sendBufferSize),
		UserID:   userID,
		Role:     role,
		UniqueID: uid,
		FullName: fullName,
	}
}

// Enqueue is non-blocking; if the buffer is full, the message is dropped and
// the client will be disconnected on next read.
func (c *Client) Enqueue(raw []byte) {
	select {
	case c.send <- raw:
	default:
		log.Printf("[WARN] ws send buffer full; dropping message for user=%d role=%s", c.UserID, c.Role)
	}
}

func (c *Client) Run() {
	c.hub.Register(c)
	defer func() {
		c.hub.Unregister(c)
		c.conn.Close()
	}()

	go c.writePump()
	c.readPump()
}

func (c *Client) readPump() {
	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[INFO] ws read closed for uid=%d: %v", c.UserID, err)
			}
			return
		}
		var env Envelope
		if err := json.Unmarshal(raw, &env); err != nil {
			c.sendError("bad_json", err.Error())
			continue
		}
		c.dispatch(env)
	}
}

func (c *Client) dispatch(env Envelope) {
	switch env.Type {
	case "ping":
		pong, _ := NewEnvelope("pong", nil)
		c.Enqueue(pong)
	case "call":
		if c.Role != "doctor" {
			c.sendError("forbidden", "only doctors can call")
			return
		}
		var p CallPayload
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			c.sendError("bad_payload", err.Error())
			return
		}
		c.hub.handleCall(c, p)
	case "accept":
		if c.Role != "assistant" {
			c.sendError("forbidden", "only assistants can accept")
			return
		}
		var p AcceptPayload
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			c.sendError("bad_payload", err.Error())
			return
		}
		c.hub.handleAccept(c, p)
	case "cancel":
		if c.Role != "doctor" {
			c.sendError("forbidden", "only doctors can cancel")
			return
		}
		var p CancelPayload
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			c.sendError("bad_payload", err.Error())
			return
		}
		c.hub.handleCancel(c, p)
	case "notify_doctor":
		if c.Role != "assistant" {
			c.sendError("forbidden", "only assistants can message doctors")
			return
		}
		var p NotifyDoctorPayload
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			c.sendError("bad_payload", err.Error())
			return
		}
		c.hub.handleNotifyDoctor(c, p)
	case "decline":
		if c.Role != "assistant" {
			c.sendError("forbidden", "only assistants can decline")
			return
		}
		var p DeclinePayload
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			c.sendError("bad_payload", err.Error())
			return
		}
		c.hub.handleDecline(c, p)
	default:
		c.sendError("unknown_type", env.Type)
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) sendError(code, msg string) {
	raw, _ := NewEnvelope("error", ErrorPayload{Code: code, Message: msg})
	c.Enqueue(raw)
}
