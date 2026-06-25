// Package ws implements the WebSocket hub and per-client connection logic.
package ws

import (
	"encoding/json"
	"time"
)

// Envelope is the wire format for every WebSocket message.
type Envelope struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// Server → Client payloads --------------------------------------------------

type PresencePayload struct {
	Assistants []AssistantView `json:"assistants"`
}

type AssistantView struct {
	UniqueID string `json:"unique_id"`
	FullName string `json:"full_name"`
	Online   bool   `json:"online"`
}

type IncomingPayload struct {
	CallID      string    `json:"call_id"`
	FromDoctor  string    `json:"from_doctor"`  // doctor full name
	Message     string    `json:"message"`
	SentAt      time.Time `json:"sent_at"`
}

type AcceptedPayload struct {
	CallID     string    `json:"call_id"`
	By         string    `json:"by"`          // assistant full name
	AcceptedAt time.Time `json:"accepted_at"`
}

type AckPayload struct {
	CallID string `json:"call_id"`
}

type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type CancelledPayload struct {
	CallID string `json:"call_id"`
	Reason string `json:"reason,omitempty"`
}

// Client → Server payloads --------------------------------------------------

type CallPayload struct {
	To      string `json:"to"`      // assistant unique_id
	Message string `json:"message"`
}

type AcceptPayload struct {
	CallID string `json:"call_id"`
}

type CancelPayload struct {
	CallID string `json:"call_id"`
}

// assistant → server: короткое сообщение врачу
type NotifyDoctorPayload struct {
	To      int64  `json:"to"` // doctor user id
	Message string `json:"message"`
}

// server → doctor: входящее сообщение от ассистента
type DoctorAlertPayload struct {
	FromAssistant string    `json:"from_assistant"`
	FromUID       string    `json:"from_uid"`
	Message       string    `json:"message"`
	SentAt        time.Time `json:"sent_at"`
}

// assistant → server: отклонение входящего вызова с причиной
type DeclinePayload struct {
	CallID string `json:"call_id"`
	Reason string `json:"reason"`
}

// server → doctor: ассистент отклонил вызов
type DeclinedPayload struct {
	CallID string `json:"call_id"`
	By     string `json:"by"`
	Reason string `json:"reason"`
}

// server → все: рассылка-уведомление от администрации
type BroadcastPayload struct {
	Message string    `json:"message"`
	From    string    `json:"from"`
	SentAt  time.Time `json:"sent_at"`
}

// Helpers -------------------------------------------------------------------

func NewEnvelope(t string, p any) ([]byte, error) {
	raw, err := json.Marshal(p)
	if err != nil {
		return nil, err
	}
	return json.Marshal(Envelope{Type: t, Payload: raw})
}
